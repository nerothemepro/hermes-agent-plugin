#!/usr/bin/env python3
"""Deterministic bridge from a HerSocial approval to a prepared video publisher payload."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Callable


POST_KEY = re.compile(r"^social-video-(youtube|facebook)-[a-f0-9]{16}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
DEFAULT_HOME = Path("/opt/data/hermes/control-plane/marketing")
DEFAULT_VIDEO_BIN = Path(__file__).resolve().parents[1] / "hersocial-marketing-video" / "start-hersocial-marketing-video.sh"


class DispatchFailure(RuntimeError):
    """Expected fail-closed approval rejection."""


def load_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def find_publisher_record(post_key: str, digest: str, home: Path) -> dict:
    match = POST_KEY.fullmatch(post_key)
    if not match or not SHA256.fullmatch(digest):
        raise DispatchFailure("approval_syntax_invalid")
    platform = match.group(1)
    root = (home / "video-projects").resolve()
    candidates: list[dict] = []
    if root.is_dir():
        for path in root.glob("*/social/publisher-" + platform + ".json"):
            record = load_json(path)
            if not record:
                continue
            if (
                record.get("schema_version") == "sdtk.marketing-social-publisher.v1"
                and record.get("platform") == platform
                and record.get("post_key") == post_key
                and record.get("content_sha256") == digest
                and record.get("approval_command") == f"APPROVE HERSOCIAL POST {post_key} {digest}"
                and isinstance(record.get("project_id"), str)
                and isinstance(record.get("publisher_payload"), dict)
                and isinstance(record["publisher_payload"].get("assetId"), str)
            ):
                candidates.append(record)
    if not candidates:
        raise DispatchFailure("publisher_record_not_found")
    if len(candidates) != 1:
        raise DispatchFailure("publisher_record_ambiguous")
    return candidates[0]


def existing_publish(record: dict, home: Path) -> dict | None:
    payload = record["publisher_payload"]
    path = home / "publishes" / f"{record['platform']}-{payload['assetId']}.json"
    published = load_json(path)
    if published is None:
        return None
    if published.get("approved_sha") != record["content_sha256"]:
        raise DispatchFailure("existing_publish_digest_mismatch")
    return published


def default_runner(args: list[str]) -> dict:
    binary = Path(os.environ.get("HERSOCIAL_MARKETING_VIDEO_BIN", str(DEFAULT_VIDEO_BIN)))
    if not binary.is_file():
        raise DispatchFailure("marketing_video_wrapper_unavailable")
    completed = subprocess.run([str(binary), *args], check=False, capture_output=True, text=True, timeout=120)
    if completed.returncode != 0:
        raise DispatchFailure("publisher_command_failed")
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise DispatchFailure("publisher_command_invalid_json") from error
    if not isinstance(value, dict):
        raise DispatchFailure("publisher_command_invalid_json")
    return value


def record_approval(
    post_key: str,
    digest: str,
    home: Path = DEFAULT_HOME,
    runner: Callable[[list[str]], dict] = default_runner,
) -> dict:
    record = find_publisher_record(post_key, digest, home)
    published = existing_publish(record, home)
    if published is not None:
        return {
            "status": "published",
            "post_key": post_key,
            "content_sha256": digest,
            "video_url": published.get("video_url"),
            "publish_record": str(home / "publishes" / f"{record['platform']}-{record['publisher_payload']['assetId']}.json"),
            "idempotent": True,
        }
    command = [
        "video", "social", "publish", record["project_id"],
        "--platform", record["platform"],
        "--approve", digest,
        "--json",
    ]
    result = runner(command)
    if not isinstance(result, dict) or result.get("status") != "published":
        raise DispatchFailure("publisher_command_unconfirmed")
    if result.get("post_key") != post_key or result.get("content_sha256") != digest:
        raise DispatchFailure("publisher_command_identity_mismatch")
    return {
        "status": "published",
        "post_key": post_key,
        "content_sha256": digest,
        "video_url": result.get("video_url"),
        "publish_record": result.get("publish_record"),
        "follow_up": result.get("follow_up"),
        "idempotent": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record-approval", nargs=2, metavar=("POST_KEY", "SHA256"), required=True)
    parser.add_argument("--marketing-home", default=os.environ.get("SDTK_MARKETING_HOME", str(DEFAULT_HOME)))
    args = parser.parse_args()
    try:
        result = record_approval(args.record_approval[0], args.record_approval[1], Path(args.marketing_home))
    except DispatchFailure as error:
        print(json.dumps({"status": "rejected", "reason": str(error)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
