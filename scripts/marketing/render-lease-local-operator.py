#!/usr/bin/env python3
"""Bounded machine-local actions for an SDTK Marketing render lease."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "host.docker.internal"}


class OperatorError(Exception):
    pass


def fail(message: str) -> int:
    print(f"render lease local operator: {message}", file=sys.stderr)
    return 2


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def child_of(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def load_context(args: argparse.Namespace) -> tuple[dict, Path, Path, Path]:
    lease_path = Path(args.lease).resolve()
    marketing_home = Path(args.marketing_home).resolve()
    output_root = Path(args.output_root).resolve()
    try:
        lease = json.loads(lease_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise OperatorError(f"lease is unreadable: {error}") from error
    required = {
        "schema_version": "sdtk.marketing-video-render-lease-request.v1",
        "state": "REQUESTED",
        "provider": "hyperframes",
    }
    if any(lease.get(key) != value for key, value in required.items()):
        raise OperatorError("lease contract is invalid")
    project_id = lease.get("project_id")
    if not isinstance(project_id, str) or not PROJECT_ID.fullmatch(project_id):
        raise OperatorError("project ID is invalid")
    if not SHA256.fullmatch(str(lease.get("creative_directive_sha256", ""))) or not SHA256.fullmatch(str(lease.get("motion_map_sha256", ""))):
        raise OperatorError("lease evidence SHA is invalid")
    project = marketing_home / "video-projects" / project_id
    canonical_lease = project / "production" / "evidence" / "render-lease.json"
    if lease_path != canonical_lease.resolve() or not child_of(project, marketing_home / "video-projects"):
        raise OperatorError("lease must be the canonical project record")
    output = Path(str(lease.get("output_reference", ""))).resolve()
    if output.suffix.lower() != ".mp4" or not child_of(output, output_root):
        raise OperatorError("output must be an MP4 inside the configured output root")
    return lease, project, output, output_root


def local_base_url(raw: str) -> str:
    parsed = urllib.parse.urlparse(raw)
    if (parsed.scheme != "http" or parsed.hostname not in LOCAL_HOSTS or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path.rstrip("/") not in {"", "/v1"}):
        raise OperatorError("base URL must be a credential-free local endpoint")
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def request_json(method: str, url: str, payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            value = json.loads(response.read().decode("utf-8") or "{}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise OperatorError("local runtime request failed") from error
    if not isinstance(value, dict):
        raise OperatorError("local runtime returned an invalid response")
    return value


def verify(project: Path, lease: dict) -> None:
    verify_env = {**os.environ, "SDTK_MARKETING_HOME": str(project.parent.parent)}
    result = subprocess.run(
        ["sdtk-marketing", "video", "production", "verify", lease["project_id"], "--json"],
        text=True, capture_output=True, timeout=60, env=verify_env,
    )
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise OperatorError("production verification returned invalid JSON") from error
    if result.returncode != 0 or report.get("ok") is not True:
        raise OperatorError("production verification failed")
    evidence = project / "production" / "evidence"
    provider_check = evidence / "provider-check.json"
    if not provider_check.is_file():
        raise OperatorError("provider check evidence is missing")
    check = json.loads(provider_check.read_text(encoding="utf-8"))
    if check.get("ok") is not True or check.get("source_sha256") != lease["motion_map_sha256"]:
        raise OperatorError("provider check does not match the lease")
    results = []
    scenes_root = project / "production" / "scenes"
    for task in sorted(scenes_root.glob("*/task.json")) if scenes_root.exists() else []:
        result_path = task.with_name("result.json")
        if not result_path.is_file():
            raise OperatorError("local executor result is missing")
        results.append({"path": str(result_path.relative_to(project)), "sha256": sha256_file(result_path)})
    atomic_json(evidence / "local-executor-bank.json", {
        "schema_version": "sdtk.marketing-video-local-executor-bank.v1",
        "project_id": lease["project_id"],
        "motion_map_sha256": lease["motion_map_sha256"],
        "provider_check_sha256": sha256_file(provider_check),
        "results": results,
        "state": "PERSISTED_BEFORE_GPU_RELEASE",
    })


def unload_lmstudio(base_url: str) -> None:
    models = request_json("GET", local_base_url(base_url) + "/api/v1/models").get("models", [])
    if not isinstance(models, list):
        raise OperatorError("LM Studio model inventory is invalid")
    instance_ids: list[str] = []
    for model in models:
        if not isinstance(model, dict):
            continue
        instances = model.get("loaded_instances", [])
        if not isinstance(instances, list):
            continue
        for instance in instances:
            if isinstance(instance, dict):
                value = instance.get("instance_id") or instance.get("id")
                if isinstance(value, str) and value and value not in instance_ids:
                    instance_ids.append(value)
    for instance_id in instance_ids:
        request_json("POST", local_base_url(base_url) + "/api/v1/models/unload", {"instance_id": instance_id})
    print(json.dumps({"status": "completed", "unloaded_count": len(instance_ids)}))


def free_comfy(base_url: str) -> None:
    request_json("POST", local_base_url(base_url) + "/free", {"unload_models": True, "free_memory": True})
    print(json.dumps({"status": "completed", "cache_freed": True}))


def render(project: Path, output: Path, hyperframes_bin: str) -> None:
    bank_path = project / "production" / "evidence" / "render-bank.json"
    if bank_path.is_file() and output.is_file():
        try:
            prior = json.loads(bank_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            prior = {}
        if (prior.get("schema_version") == "sdtk.marketing-video-render-bank.v1"
                and prior.get("project_id") == project.name
                and prior.get("output_reference") == str(output)
                and prior.get("state") == "BANKED_NOT_ACCEPTED"
                and prior.get("sha256") == sha256_file(output)):
            return
    if output.exists():
        raise OperatorError("unbanked output already exists; no file was overwritten")
    provider = project / "provider" / "hyperframes"
    if not provider.is_dir() or not (provider / "index.html").is_file():
        raise OperatorError("HyperFrames provider source is missing")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [hyperframes_bin, "render", str(provider), "--output", str(output), "--quality", "high", "--strict", "--no-best-effort", "--workers", "1"]
    result = subprocess.run(command, text=True, capture_output=True, timeout=7200)
    if result.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
        raise OperatorError("HyperFrames render failed; no output was banked")


def bank(project: Path, output: Path, lease: dict) -> None:
    if not output.is_file() or output.stat().st_size == 0:
        raise OperatorError("render output is unavailable")
    frame_rows = []
    snapshots = project / "production" / "evidence" / "snapshots"
    for frame in sorted(snapshots.rglob("*.png")) if snapshots.exists() else []:
        frame_rows.append({"path": str(frame.relative_to(project)), "sha256": sha256_file(frame)})
    atomic_json(project / "production" / "evidence" / "render-bank.json", {
        "schema_version": "sdtk.marketing-video-render-bank.v1",
        "project_id": lease["project_id"],
        "output_reference": str(output),
        "sha256": sha256_file(output),
        "size_bytes": output.stat().st_size,
        "evidence_frames": frame_rows,
        "state": "BANKED_NOT_ACCEPTED",
    })


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("action", choices=("verify", "unload-lmstudio", "free-comfy", "render", "bank"))
    result.add_argument("--lease", required=True)
    result.add_argument("--marketing-home", required=True)
    result.add_argument("--output-root", required=True)
    result.add_argument("--base-url")
    result.add_argument("--hyperframes-bin", default="hyperframes")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        lease, project, output, _ = load_context(args)
        if args.action == "verify":
            verify(project, lease)
        elif args.action == "unload-lmstudio":
            if not args.base_url:
                raise OperatorError("--base-url is required")
            unload_lmstudio(args.base_url)
        elif args.action == "free-comfy":
            if not args.base_url:
                raise OperatorError("--base-url is required")
            free_comfy(args.base_url)
        elif args.action == "render":
            render(project, output, args.hyperframes_bin)
        else:
            bank(project, output, lease)
        return 0
    except (OperatorError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        return fail(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
