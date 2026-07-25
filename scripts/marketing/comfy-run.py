#!/usr/bin/env python3
"""Fail-closed SDTK-Marketing ComfyUI delegate for LTX/WAN video workflows."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[2]
GRAPH_ROOT = PLUGIN_ROOT / "scripts" / "marketing" / "graphs"
PIPELINE_ROOT = Path("/workspace/hermes-agent-plugin/media-pipeline")
MEDIA_ENV = Path("/opt/data/hermes/media-pipeline.env")


def fail(message: str, code: int = 2) -> int:
    print(f"comfyui delegate: {message}", file=sys.stderr)
    return code


def parse_completed_payload(stdout: str) -> dict:
    starts = [index for index, char in enumerate(stdout) if char == "{"]
    for start in reversed(starts):
        try:
            payload = json.loads(stdout[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("status") == "completed":
            return payload
    raise ValueError("pipeline did not return a completed JSON payload")


def run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    graph = Path(args.graph)
    if not graph.is_absolute():
        # Kit workflow definitions use "graphs/<name>"; resolve that relative to the
        # versioned graph root without allowing an arbitrary filesystem path.
        parts = graph.parts
        if parts and parts[0] == "graphs":
            graph = Path(*parts[1:])
        graph = GRAPH_ROOT / graph
    graph = graph.resolve()
    if not graph.is_file() or GRAPH_ROOT not in graph.parents:
        return fail("graph must resolve to a versioned graph under scripts/marketing/graphs")
    if not args.input.strip():
        return fail("--input prompt is required")
    if not MEDIA_ENV.is_file():
        return fail("media pipeline environment is unavailable")

    output = Path(args.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    name = graph.name
    if name == "intro-spectacle.ltx.json":
        command = [
            sys.executable,
            str(PIPELINE_ROOT / "generate_ltx_video.py"),
            "--prompt", args.input,
            "--mode", "test",
            "--style", "product",
            "--workflow", str(graph),
            "--env-file", str(MEDIA_ENV),
        ]
    elif name == "broll.wan.json":
        command = [
            sys.executable,
            str(PIPELINE_ROOT / "generate_video.py"),
            "--prompt", args.input,
            "--mode", "test",
            "--wan-workflow", str(graph),
            "--env-file", str(MEDIA_ENV),
        ]
    else:
        return fail(f"unsupported versioned graph: {name}")

    if not Path(command[1]).is_file():
        return fail("media pipeline script is unavailable")
    completed = subprocess.run(command, cwd=str(PIPELINE_ROOT), text=True, capture_output=True, check=False)
    if completed.returncode != 0:
        detail = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "renderer failed"
        return fail(detail, 1)
    try:
        payload = parse_completed_payload(completed.stdout)
        video_path = Path(str(payload["video_path"])).resolve()
    except (KeyError, TypeError, ValueError) as error:
        return fail(f"invalid media pipeline completion payload: {error}", 1)
    if not video_path.is_file():
        return fail("pipeline completed without a video file", 1)
    shutil.copyfile(video_path, output)
    if not output.is_file() or output.stat().st_size == 0:
        return fail("could not copy rendered video to requested output", 1)
    print(str(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
