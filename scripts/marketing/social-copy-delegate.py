#!/usr/bin/env python3
"""Bounded LM Studio delegate for governed sdtk-marketing social-copy generation."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib import error, request


DEFAULT_TIMEOUT_SECONDS = 45
MAX_TIMEOUT_SECONDS = 55


def fail(message: str) -> int:
    print(f"social-copy delegate: {message}", file=sys.stderr)
    return 1


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("source must be a JSON object")
    return value


def endpoint(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def timeout_seconds() -> int:
    raw = os.environ.get("SDTK_MARKETING_SOCIAL_COPY_HTTP_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("HTTP timeout must be an integer") from exc
    if value <= 0 or value > MAX_TIMEOUT_SECONDS:
        raise ValueError(f"HTTP timeout must be between 1 and {MAX_TIMEOUT_SECONDS} seconds")
    return value


def prompt_for(source: dict) -> str:
    allowed = source.get("allowed_claims", [])
    claim_ids = [claim.get("id") for claim in allowed if isinstance(claim.get("id"), str) and claim.get("id")]
    if not claim_ids:
        raise ValueError("source has no allowed claim IDs")

    variants = []
    for platform in source.get("platforms", []):
        for angle in source.get("angles", []):
            variant = {
                "variant_id": f"{platform}-{angle}",
                "platform": platform,
                "angle": angle,
                "language": "en",
                "claim_refs": ["REPLACE_WITH_ALLOWED_CLAIM_ID_THAT_SUPPORTS_THIS_VARIANT"],
            }
            if platform == "x":
                variant.update({"format": "single", "posts": ["WRITE ONE ENGLISH X POST HERE"]})
            elif platform == "facebook":
                variant.update({"format": "video_post", "page_copy": "WRITE ENGLISH FACEBOOK PAGE COPY HERE", "first_comment": "WRITE OPTIONAL ENGLISH FIRST COMMENT HERE"})
            elif platform == "youtube":
                variant.update({"format": "video", "title": "WRITE ENGLISH YOUTUBE TITLE HERE", "description": "WRITE ENGLISH YOUTUBE DESCRIPTION HERE", "tags": ["SDTK"], "pinned_comment": "WRITE OPTIONAL ENGLISH PINNED COMMENT HERE"})
            else:
                raise ValueError(f"unsupported source platform: {platform}")
            variants.append(variant)

    template = {"canonical_concept": "WRITE ONE ENGLISH CONCEPT", "variants": variants}
    return "\n".join([
        "Create English social-marketing candidates for an owner-reviewed SDTK video.",
        "Return one JSON object only. Do not use markdown or prose outside JSON.",
        "Use only the exact allowed_claim IDs and claims in the source. Do not invent numbers, features, customer results, or unsupported claims.",
        "Complete the exact JSON template below. Preserve every key, variant_id, platform, angle, language, format, and array/object shape exactly.",
        "Replace every claim_refs placeholder with one or more exact allowed IDs that materially support the actual wording in that variant. Never omit claim_refs or leave any placeholder text.",
        "For X, posts must be an array of plain strings, never objects. For Facebook, use top-level page_copy and optional first_comment, never a video_post object.",
        "For YouTube, tags must be a non-empty array of plain strings. Do not add root schema_version, project_id, source_identity_sha256, or any fields not in the template.",
        "Allowed claim IDs: " + json.dumps(claim_ids),
        "Required output template:",
        json.dumps(template, ensure_ascii=True, separators=(",", ":")),
        "Source pack:",
        json.dumps(source, ensure_ascii=True, separators=(",", ":")),
    ])


def response_json(content: str) -> dict:
    value = content.strip()
    if value.startswith("```"):
        lines = value.splitlines()
        if len(lines) >= 3 and lines[-1].strip().startswith("```"):
            value = "\n".join(lines[1:-1]).strip()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("model response was not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("model response must be a JSON object")
    if not isinstance(parsed.get("canonical_concept"), str) or not parsed["canonical_concept"].strip():
        raise ValueError("model response missing canonical_concept")
    if not isinstance(parsed.get("variants"), list) or not parsed["variants"]:
        raise ValueError("model response missing variants")
    return parsed


def generate(source: dict, base_url: str, model: str, api_key: str | None) -> dict:
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": "You are a constrained copy generator. Follow the source contract exactly."},
            {"role": "user", "content": prompt_for(source)},
        ],
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = request.Request(
        endpoint(base_url),
        data=json.dumps(payload, ensure_ascii=True).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout_seconds()) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        raise RuntimeError(f"model request failed with HTTP {exc.code}") from exc
    except error.URLError as exc:
        raise RuntimeError("model request failed") from exc
    try:
        decoded = json.loads(body)
        content = decoded["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("model response did not contain a chat completion") from exc
    if not isinstance(content, str):
        raise ValueError("model response content must be text")
    generated = response_json(content)
    return {
        "schema_version": "sdtk.marketing-social-candidates.v1",
        "project_id": source.get("project_id"),
        "source_identity_sha256": source.get("identity_sha256"),
        "language": "en",
        "canonical_concept": generated["canonical_concept"].strip(),
        "variants": generated["variants"],
    }


def atomic_write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".social-copy-", suffix=".json", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="LM Studio delegate for sdtk-marketing video social")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)

    base_url = os.environ.get("LMSTUDIO_BASE_URL", "").strip()
    model = os.environ.get("LLM_DEFAULT_MODEL", "").strip()
    if not base_url:
        return fail("LMSTUDIO_BASE_URL is not configured")
    if not model:
        return fail("LLM_DEFAULT_MODEL is not configured")
    try:
        source = read_json(args.input)
        if source.get("schema_version") != "sdtk.marketing-social-source.v1":
            return fail("input is not an sdtk marketing social source")
        if source.get("language") != "en":
            return fail("source language must be en")
        if not source.get("identity_sha256") or not source.get("project_id"):
            return fail("source identity or project is missing")
        atomic_write(args.output, generate(source, base_url, model, os.environ.get("LM_API_KEY")))
    except (OSError, ValueError, RuntimeError) as exc:
        return fail(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
