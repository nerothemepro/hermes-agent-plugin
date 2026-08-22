#!/usr/bin/env python3
"""Bounded local LM Studio delegate for one approved HyperFrames scene task."""
from __future__ import annotations
import argparse, hashlib, json, os, re, sys
from pathlib import Path
from urllib import error, request

DOCTOR_SCHEMA = "sdtk.marketing-video-local-executor-doctor.v1"
RESULT_SCHEMA = "sdtk.marketing-video-local-executor-result.v1"
TASK_SCHEMA = "sdtk.marketing-video-scene-task.v1"
LOCAL = re.compile(r"^https?://(?:127\.0\.0\.1|localhost|host\.docker\.internal)(?::\d+)?(?:/|$)")
FORBIDDEN = re.compile(r"https?://|\bcurl\b|\bwget\b|\bbash\b|\bsh\b|child_process|require\s*\(|process\.|\.\./|\x60", re.I)

def fail(message):
    print("lmstudio scene executor: " + message, file=sys.stderr)
    return 1

def base_url():
    value = os.environ.get("LMSTUDIO_BASE_URL", "").strip().rstrip("/")
    if not LOCAL.match(value): raise ValueError("LMSTUDIO_BASE_URL must be a local loopback or Docker host bridge endpoint")
    return value

def endpoint(base, suffix):
    return base + suffix if not base.endswith("/v1") else base + suffix[3:]

def names(key): return {x.strip() for x in os.environ.get(key, "").split(",") if x.strip()}
def timeout():
    value = int(os.environ.get("SDTK_MARKETING_VIDEO_LMSTUDIO_TIMEOUT_SECONDS", "45"))
    if value < 1 or value > 55: raise ValueError("LM Studio timeout must be between 1 and 55 seconds")
    return value

def headers():
    value = {"Content-Type": "application/json"}
    if os.environ.get("LM_API_KEY"): value["Authorization"] = "Bearer " + os.environ["LM_API_KEY"]
    return value

def query_models(base):
    try:
        with request.urlopen(request.Request(endpoint(base, "/v1/models"), headers=headers()), timeout=timeout()) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc: raise RuntimeError("model list request failed with HTTP " + str(exc.code)) from exc
    except error.URLError as exc: raise RuntimeError("model list request failed") from exc
    return {item.get("id") for item in data.get("data", []) if isinstance(item, dict) and isinstance(item.get("id"), str)}

def doctor():
    base = base_url(); allowed = names("SDTK_MARKETING_VIDEO_LOCAL_MODELS"); structured = names("SDTK_MARKETING_VIDEO_LMSTUDIO_STRUCTURED_MODELS"); available = query_models(base)
    print(json.dumps({"schema_version": DOCTOR_SCHEMA, "endpoint": base, "models": [{"id": x, "structured_output": x in structured} for x in sorted(allowed & available)]}, separators=(",", ":")))

def sha(value): return hashlib.sha256((json.dumps(value, ensure_ascii=False, indent=2, separators=(",", ": ")) + "\n").encode()).hexdigest()
def task_from(file, model):
    task = json.loads(file.read_text(encoding="utf-8"))
    scene = task.get("scene") if isinstance(task, dict) else None
    if task.get("schema_version") != TASK_SCHEMA or task.get("provider") != "hyperframes" or not isinstance(scene, dict) or not isinstance(scene.get("id"), str): raise ValueError("task is not a bounded HyperFrames scene task")
    if model not in names("SDTK_MARKETING_VIDEO_LOCAL_MODELS") or model not in names("SDTK_MARKETING_VIDEO_LMSTUDIO_STRUCTURED_MODELS"): raise ValueError("model is not explicitly allowlisted for structured output")
    return task, sha(task)

def proposal_schema():
    return {"type":"object","additionalProperties":False,"required":["motion_id","source_fragment","approved_media_ids_csv"],"properties":{"motion_id":{"type":"string"},"source_fragment":{"type":"string"},"approved_media_ids_csv":{"type":"string"}}}

def canonical_result(message, task, task_sha, model):
    raw = message.get("content") if isinstance(message, dict) else None
    if not isinstance(raw, str) or not raw.strip(): raw = message.get("reasoning_content") if isinstance(message, dict) else None
    if not isinstance(raw, str) or not raw.strip(): raise ValueError("scene response did not contain structured JSON")
    proposal = json.loads(raw)
    expected = {"motion_id", "source_fragment", "approved_media_ids_csv"}
    if not isinstance(proposal, dict) or set(proposal) != expected: raise ValueError("scene proposal violates the flat compatibility schema")
    motion, source, csv = proposal["motion_id"], proposal["source_fragment"], proposal["approved_media_ids_csv"]
    if not isinstance(motion, str) or motion not in task.get("allowed_motion_ids", []): raise ValueError("scene proposal selects an unapproved motion")
    if not isinstance(source, str) or not source or len(source) > 4000 or FORBIDDEN.search(source): raise ValueError("scene proposal contains unsafe source")
    if not isinstance(csv, str): raise ValueError("scene proposal media selection is invalid")
    media = [] if not csv.strip() else [value.strip() for value in csv.split(",")]
    if any(not value for value in media) or len(media) != len(set(media)) or any(value not in task.get("allowed_media_ids", []) for value in media): raise ValueError("scene proposal references unapproved media")
    return {"schema_version":RESULT_SCHEMA,"task_sha256":task_sha,"model_id":model,"fragments":[{"scene_id":task["scene"]["id"],"kind":"provider_source_fragment","content":{"operation":"propose_provider_fragment","motion_id":motion,"source_fragment":source,"approved_media_ids":media}}]}

def validate(result, task, task_sha, model):
    required = {"schema_version","task_sha256","model_id","fragments"}
    if not isinstance(result, dict) or not required.issubset(result) or set(result) - (required | {"notes"}): raise ValueError("model result violates the bounded result shape")
    if result["schema_version"] != RESULT_SCHEMA or result["task_sha256"] != task_sha or result["model_id"] != model or not isinstance(result["fragments"], list) or len(result["fragments"]) > 1: raise ValueError("model result is not bound to the approved task")
    for fragment in result["fragments"]:
        if not isinstance(fragment, dict) or set(fragment) != {"scene_id","kind","content"} or fragment["scene_id"] != task["scene"]["id"] or fragment["kind"] != "provider_source_fragment": raise ValueError("model fragment is outside the approved scene")
        content = fragment["content"]
        if not isinstance(content, dict) or set(content) != {"operation","motion_id","source_fragment","approved_media_ids"}: raise ValueError("model fragment content is invalid")
        if content["operation"] != "propose_provider_fragment" or content["motion_id"] not in task.get("allowed_motion_ids", []) or not isinstance(content["source_fragment"], str) or FORBIDDEN.search(content["source_fragment"]): raise ValueError("model fragment contains unsafe source")
        if not isinstance(content["approved_media_ids"], list) or any(x not in task.get("allowed_media_ids", []) for x in content["approved_media_ids"]): raise ValueError("model fragment references unapproved media")
    return result

def execute(file, model):
    base = base_url(); task, task_sha = task_from(file, model)
    prompt = "Return JSON only. Propose one HyperFrames source fragment for this locked task as a flat object with motion_id, source_fragment, and approved_media_ids_csv (comma-separated approved IDs, or empty). Do not alter claims, CTA, facts, paths, URLs, credentials, shell commands, publish actions, or owner decisions. " + json.dumps(task, ensure_ascii=True, separators=(",",":"))
    payload = {"model":model,"temperature":0,"messages":[{"role":"system","content":"You are a constrained local video scene assistant."},{"role":"user","content":prompt}],"response_format":{"type":"json_schema","json_schema":{"name":"sdtk_marketing_scene_proposal","strict":True,"schema":proposal_schema()}}}
    try:
        req = request.Request(endpoint(base, "/v1/chat/completions"), data=json.dumps(payload, ensure_ascii=True).encode(), headers=headers(), method="POST")
        with request.urlopen(req, timeout=timeout()) as response: message = json.loads(response.read().decode("utf-8"))["choices"][0]["message"]
        result = canonical_result(message, task, task_sha, model)
    except error.HTTPError as exc: raise RuntimeError("scene request failed with HTTP " + str(exc.code)) from exc
    except (error.URLError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc: raise ValueError("scene request did not return structured JSON") from exc
    print(json.dumps(validate(result, task, task_sha, model), ensure_ascii=True, separators=(",",":")))

def main(argv):
    parser = argparse.ArgumentParser(); group = parser.add_mutually_exclusive_group(required=True); group.add_argument("--doctor", action="store_true"); group.add_argument("--task", type=Path); parser.add_argument("--model"); args = parser.parse_args(argv)
    if args.doctor:
        if args.model: raise ValueError("doctor does not accept --model")
        doctor(); return 0
    if not args.model: raise ValueError("--task requires --model")
    execute(args.task, args.model); return 0

if __name__ == "__main__":
    try: raise SystemExit(main(sys.argv[1:]))
    except (OSError, ValueError, RuntimeError) as exc: raise SystemExit(fail(str(exc)))
