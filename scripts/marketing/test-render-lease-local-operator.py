#!/usr/bin/env python3
"""Regression tests for the bounded local render-lease operator."""

from __future__ import annotations

import hashlib
import http.server
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("render-lease-local-operator.py")


class FakeHandler(http.server.BaseHTTPRequestHandler):
    requests: list[tuple[str, object]] = []
    models: list[dict] = []

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        self.requests.append((self.path, None))
        if self.path == "/api/v1/models":
            self._json(200, {"models": self.models})
        else:
            self._json(404, {})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        self.requests.append((self.path, payload))
        self._json(200, {"ok": True})


class LocalOperatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="render-lease-operator-")
        self.root = Path(self.temp.name)
        self.marketing_home = self.root / "marketing"
        self.project = self.marketing_home / "video-projects" / "demo"
        self.provider = self.project / "provider" / "hyperframes"
        self.evidence = self.project / "production" / "evidence"
        self.provider.mkdir(parents=True)
        self.evidence.mkdir(parents=True)
        (self.provider / "index.html").write_text("<!doctype html><title>demo</title>\n")
        self.output_root = self.root / "review"
        self.output_root.mkdir()
        self.output = self.output_root / "demo.mp4"
        self.lease = self.evidence / "render-lease.json"
        self.lease.write_text(json.dumps({
            "schema_version": "sdtk.marketing-video-render-lease-request.v1",
            "state": "REQUESTED",
            "provider": "hyperframes",
            "project_id": "demo",
            "output_reference": str(self.output),
            "creative_directive_sha256": "a" * 64,
            "motion_map_sha256": "b" * 64,
        }))
        FakeHandler.requests = []
        FakeHandler.models = []
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def run_operator(self, action: str, **extra: str) -> subprocess.CompletedProcess[str]:
        command = [
            "python3", str(SCRIPT), action, "--lease", str(self.lease),
            "--marketing-home", str(self.marketing_home),
            "--output-root", str(self.output_root),
        ]
        for key, value in extra.items():
            command.extend(["--" + key.replace("_", "-"), value])
        return subprocess.run(command, text=True, capture_output=True, env={**os.environ, "PATH": os.environ["PATH"]})

    def test_unload_lmstudio_unloads_only_loaded_instances(self) -> None:
        FakeHandler.models = [
            {"key": "loaded", "loaded_instances": [{"id": "instance-a"}, {"instance_id": "instance-b"}]},
            {"key": "idle", "loaded_instances": []},
        ]
        result = self.run_operator("unload-lmstudio", base_url=self.base_url + "/v1")
        self.assertEqual(result.returncode, 0, result.stderr)
        posts = [item for item in FakeHandler.requests if item[0] == "/api/v1/models/unload"]
        self.assertEqual(posts, [
            ("/api/v1/models/unload", {"instance_id": "instance-a"}),
            ("/api/v1/models/unload", {"instance_id": "instance-b"}),
        ])
        self.assertNotIn("instance-a", result.stdout)

    def test_unload_lmstudio_is_idempotent_when_nothing_is_loaded(self) -> None:
        result = self.run_operator("unload-lmstudio", base_url=self.base_url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(path.endswith("/unload") for path, _ in FakeHandler.requests))

    def test_free_comfy_posts_exact_bounded_request(self) -> None:
        result = self.run_operator("free-comfy", base_url=self.base_url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(("/free", {"unload_models": True, "free_memory": True}), FakeHandler.requests)

    def test_verify_banks_executor_results_before_gpu_release(self) -> None:
        fake_bin_dir = self.root / "bin"
        fake_bin_dir.mkdir()
        fake_cli = fake_bin_dir / "sdtk-marketing"
        fake_cli.write_text("#!/bin/sh\nprintf '%s\\n' '{\"ok\":true}'\n")
        fake_cli.chmod(0o755)
        (self.evidence / "provider-check.json").write_text(json.dumps({
            "ok": True, "source_sha256": "b" * 64,
        }))
        scene = self.project / "production" / "scenes" / "scene-1"
        scene.mkdir(parents=True)
        (scene / "task.json").write_text("{}\n")
        (scene / "result.json").write_text('{"status":"completed"}\n')
        result = subprocess.run([
            "python3", str(SCRIPT), "verify", "--lease", str(self.lease),
            "--marketing-home", str(self.marketing_home), "--output-root", str(self.output_root),
        ], text=True, capture_output=True, env={**os.environ, "PATH": str(fake_bin_dir) + os.pathsep + os.environ["PATH"]})
        self.assertEqual(result.returncode, 0, result.stderr)
        bank = json.loads((self.evidence / "local-executor-bank.json").read_text())
        self.assertEqual(bank["state"], "PERSISTED_BEFORE_GPU_RELEASE")
        self.assertEqual(bank["results"][0]["path"], "production/scenes/scene-1/result.json")

    def test_remote_endpoint_is_rejected(self) -> None:
        result = self.run_operator("free-comfy", base_url="https://example.com")
        self.assertEqual(result.returncode, 2)
        self.assertIn("local endpoint", result.stderr)

    def test_render_uses_fixed_hyperframes_argv_and_safe_output(self) -> None:
        fake_bin = self.root / "fake-hyperframes"
        args_file = self.root / "args.json"
        fake_bin.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().splitlines()))' > \"$HF_ARGS\"\nprintf video > \"$4\"\n")
        fake_bin.chmod(0o755)
        env = {**os.environ, "HF_ARGS": str(args_file)}
        result = subprocess.run([
            "python3", str(SCRIPT), "render", "--lease", str(self.lease),
            "--marketing-home", str(self.marketing_home), "--output-root", str(self.output_root),
            "--hyperframes-bin", str(fake_bin),
        ], text=True, capture_output=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(args_file.read_text()), [
            "render", str(self.provider), "--output", str(self.output),
            "--quality", "high", "--strict", "--no-best-effort", "--workers", "1",
        ])
        self.assertEqual(self.output.read_bytes(), b"video")

    def test_render_never_overwrites_unbanked_existing_output(self) -> None:
        self.output.write_bytes(b"owner-existing")
        result = self.run_operator("render", hyperframes_bin="/bin/true")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.output.read_bytes(), b"owner-existing")

    def test_output_path_traversal_is_rejected(self) -> None:
        payload = json.loads(self.lease.read_text())
        payload["output_reference"] = str(self.root / "outside.mp4")
        self.lease.write_text(json.dumps(payload))
        result = self.run_operator("render", hyperframes_bin="/bin/true")
        self.assertEqual(result.returncode, 2)
        self.assertIn("output root", result.stderr)

    def test_bank_writes_hash_bound_receipt_without_accepting_asset(self) -> None:
        self.output.write_bytes(b"final-video")
        result = self.run_operator("bank")
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((self.evidence / "render-bank.json").read_text())
        self.assertEqual(receipt["sha256"], hashlib.sha256(b"final-video").hexdigest())
        self.assertEqual(receipt["state"], "BANKED_NOT_ACCEPTED")
        self.assertNotIn("command", receipt)

    def test_render_reuses_only_hash_valid_banked_output(self) -> None:
        self.output.write_bytes(b"banked-video")
        receipt = {
            "schema_version": "sdtk.marketing-video-render-bank.v1",
            "project_id": "demo",
            "output_reference": str(self.output),
            "sha256": hashlib.sha256(b"banked-video").hexdigest(),
            "size_bytes": len(b"banked-video"),
            "evidence_frames": [],
            "state": "BANKED_NOT_ACCEPTED",
        }
        (self.evidence / "render-bank.json").write_text(json.dumps(receipt))
        result = self.run_operator("render", hyperframes_bin="/path/that/must/not/run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_bytes(), b"banked-video")


if __name__ == "__main__":
    unittest.main()
