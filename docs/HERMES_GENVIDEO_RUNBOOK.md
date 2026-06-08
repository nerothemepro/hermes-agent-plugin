# Hermes GenVideo Runbook

This runbook captures the working setup and failure fixes for the local Hermes GenVideo workflow:

```text
Telegram -> Hermes GenVideo profile -> generate_video tool -> ComfyUI Flux keyframe -> Wan2.1 I2V -> MEDIA:/opt/data/hermes/generated-videos/*.mp4
```

## Current working design

- Hermes container: `hermes-sandbox`
- Hermes profile/home: `/opt/data/hermes`
- Hermes source: `/workspace/hermes-agent`
- Local media plugin: `/workspace/hermes-agent/plugins/local_media`
- Media pipeline: `/workspace/projects/media-pipeline/generate_video.py`
- ComfyUI endpoint: `http://host.docker.internal:8188`
- Wan2.1 endpoint: `http://host.docker.internal:8010`
- LM Studio endpoint: `http://host.docker.internal:1234/v1`
- GenVideo model: `google/gemma-4-12b-qat`
- Images: `/opt/data/hermes/generated-images`
- Videos: `/opt/data/hermes/generated-videos`

## Hermes GenVideo profile

Keep this profile narrow. It should route video requests, call one local tool, and send the final file.

Expected `config.yaml` essentials:

```yaml
model:
  default: google/gemma-4-12b-qat
  provider: lmstudio
  base_url: http://host.docker.internal:1234/v1
  context_length: 65536

memory:
  memory_enabled: false
  user_profile_enabled: false
  memory_char_limit: 0
  user_char_limit: 0

plugins:
  enabled:
  - local_media

platform_toolsets:
  cli:
  - clarify
  - messaging
  - local_media
  telegram:
  - clarify
  - messaging
  - local_media

known_plugin_toolsets:
  cli:
  - local_media
  telegram:
  - local_media
```

## Skill and references

Agent-facing skill:

```text
/opt/data/hermes/skills/creative/local-comfy-wan-video/SKILL.md
```

Detailed references:

```text
/opt/data/hermes/skills/creative/local-comfy-wan-video/references/setup-checklist.md
/opt/data/hermes/skills/creative/local-comfy-wan-video/references/known-failures.md
/opt/data/hermes/skills/creative/local-comfy-wan-video/references/quality-tuning.md
/opt/data/hermes/skills/creative/local-comfy-wan-video/references/operations.md
```

The skill is intentionally concise. The references preserve the long troubleshooting knowledge without polluting every chat turn.

## Start and status commands

From Windows PowerShell:

```powershell
docker exec -it hermes-sandbox bash -lc "env HERMES_HOME=/opt/data/hermes LM_API_KEY=lm-studio /workspace/.venvs/hermes-agent/bin/hermes gateway stop || true"

docker exec -d hermes-sandbox bash -lc "cd /workspace/hermes-agent && mkdir -p /opt/data/hermes/logs && env HERMES_HOME=/opt/data/hermes LM_API_KEY=lm-studio /workspace/.venvs/hermes-agent/bin/hermes gateway run >> /opt/data/hermes/logs/gateway.log 2>&1"

docker exec -it hermes-sandbox bash -lc "env HERMES_HOME=/opt/data/hermes LM_API_KEY=lm-studio /workspace/.venvs/hermes-agent/bin/hermes gateway status"
```

Avoid backgrounding with `&` inside an interactive `docker exec`; it caused zombie gateway processes and stale Telegram locks.

## Health checks

```powershell
docker exec -it hermes-sandbox bash -lc "curl -s http://host.docker.internal:1234/v1/models | jq -r '.data[].id'"

docker exec -it hermes-sandbox bash -lc "curl -s http://host.docker.internal:8188/system_stats | head -c 1000"

docker exec -it hermes-sandbox bash -lc "curl -s http://host.docker.internal:8010/health"
```

Expected:

- LM Studio exposes `google/gemma-4-12b-qat`.
- ComfyUI reports CUDA RTX 3090.
- Wan2.1 reports `cuda_available: true` and `model_dir_exists: true`.

## Verify generate_video tool

```bash
cd /workspace/hermes-agent
env HERMES_HOME=/opt/data/hermes LM_API_KEY=lm-studio /workspace/.venvs/hermes-agent/bin/python - <<'PY'
from hermes_cli.plugins import discover_plugins
from tools.registry import registry

discover_plugins(force=True)
print(registry.get_tool_names_for_toolset('local_media'))
print(bool(registry.get_entry('generate_video')))
PY
```

Expected:

```text
['generate_video']
True
```

## Smoke test vs quality

Smoke test is only for plumbing:

```json
{"mode":"test", "use_smoke_image":true}
```

Expected smoke output can be ugly:

```text
frames=5
wan_steps=1
file around 200-250KB
duration about 0.6-0.8s
```

Real video must use quality:

```json
{"mode":"quality"}
```

Current quality baseline in `/workspace/projects/media-pipeline/generate_video.py`:

```text
frames=33
wan_steps=20
flux_steps=20
width=832
height=480
```

## ComfyUI output rule

ComfyUI history output like this is not a local file path:

```json
{"filename":"example_00001_.mp4","subfolder":"hermes_video","type":"output"}
```

Correct procedure:

1. Call ComfyUI `/view` with `filename`, `subfolder`, and `type`.
2. Save bytes to `/opt/data/hermes/generated-videos/<safe-name>.mp4`.
3. Send Telegram attachment as `MEDIA:/opt/data/hermes/generated-videos/<safe-name>.mp4`.

The `generate_video` tool already does this and verifies the file exists.

## Known root causes and fixes

### Gateway does not respond

Check status and logs:

```bash
env HERMES_HOME=/opt/data/hermes LM_API_KEY=lm-studio /workspace/.venvs/hermes-agent/bin/hermes gateway status
tail -120 /opt/data/hermes/logs/gateway.log
```

### Telegram token already in use

If log says:

```text
Telegram bot token already in use (PID xxxx)
```

Check whether PID is zombie:

```bash
ps -fp <PID> || true
find /root/.local/state/hermes/gateway-locks -maxdepth 1 -type f -printf '%s %p\n' -exec cat {} \;
```

If lock belongs to a defunct PID, remove only that PID's scoped lock:

```bash
cd /workspace/hermes-agent
env HERMES_HOME=/opt/data/hermes /workspace/.venvs/hermes-agent/bin/python - <<'PY'
from gateway.status import release_all_scoped_locks
print(release_all_scoped_locks(owner_pid=PID_HERE))
PY
```

Then restart gateway.

### LM Studio context mismatch

If log says `n_keep >= n_ctx`, LM Studio loaded the model with too small real context, usually 4096. Set the model context in LM Studio to 65536 and reload the model.

### Jinja "No user query found"

Usually caused by bad/stale session history, especially an assistant-only first message after media delivery/reset. Start a new session or clean bad session rows in `/opt/data/hermes/state.db` after backup.

### Video is noisy or unreadable

Most likely smoke/test mode. Check file size/duration/frames. Real requests must use `mode=quality` and must not set `use_smoke_image=true`.

## Telegram prompts

Smoke:

```text
Chay smoke test video bang tool generate_video. Prompt: "an eagle flying over a lake". mode=test, use_smoke_image=true. Khi xong gui video bang MEDIA path.
```

Quality:

```text
Tao can tao video quality: "A bald eagle flying low over a clear mountain lake, wings fully spread, cinematic natural light, photorealistic feathers, stable camera, smooth motion". Dung generate_video mode=quality. Khong dung smoke image. Gui video cho tao bang MEDIA path.
```

## Do not do these

- Do not touch `ai-sandbox`.
- Do not remove Docker volumes.
- Do not run `docker system prune`.
- Do not run Hermes GenVideo with full toolsets unless actively debugging.
- Do not use smoke output to judge visual quality.

### ComfyUI history network hiccup after a long run

Symptom:

```text
generate_video failed: Cannot reach http://host.docker.internal:8188/history/<prompt_id>: [Errno 101] Network is unreachable
```

Root cause: the ComfyUI job may have completed successfully, but one Python polling request to `/history/<prompt_id>` hit a transient Docker Desktop/`host.docker.internal` network hiccup, often around IPv6 routing. Do not assume the generation failed. Check `/history/<prompt_id>` first.

Fix now implemented in `/workspace/projects/media-pipeline/generate_video.py`: HTTP JSON/file calls retry transient `URLError`, and `poll_comfy` tolerates temporary `/history` or `/queue` failures until timeout.

## Multi-shot sequence tool

Use `generate_video_sequence` for longer action videos, especially 15-30 second anime action scenes. Default behavior:

```text
duration_seconds=20
mode=quality
style=original_japanese_anime_action
continuity=last_frame
```

The tool renders several short Wan I2V shots, extracts the tail frame from each shot, chains it into the next shot, then stitches the shot videos into one final MP4. It returns `MEDIA:/opt/data/hermes/generated-videos/<final>.mp4`. Keep the style original: do not use exact Kimetsu no Yaiba characters, costumes, logos, or copyrighted identities. Use original Japanese shonen anime sword-fight language instead.

### Multi-shot implementation status

Implemented and verified:

- Script: `/workspace/projects/media-pipeline/generate_video_sequence.py`
- Hermes tool: `generate_video_sequence` in plugin `local_media`
- Dependency: `imageio-ffmpeg` installed in `/workspace/.venvs/hermes-agent`
- Smoke sequence passed with 2 test shots, last-frame chaining, ffmpeg concat, and manifest output.
- Smoke output: `/opt/data/hermes/generated-videos/smoke-test-two-original-anime-samurai-sword-clash-sequence-1780889859-7b2d532b.mp4`
- Smoke manifest: `/opt/data/hermes/media-sequences/smoke-test-two-original-anime-samurai-sword-clash-1780889859-7b2d532b/manifest.json`

For quality anime action sequences, ask Hermes to call `generate_video_sequence` with `duration_seconds=20`, `mode=quality`, `style=original_japanese_anime_action`, and `continuity=last_frame`.

### Remote end closed during quality sequence

Symptom:

```text
generate_video_sequence failed: shot generation failed: Remote end closed connection without response
```

Root cause: transient ComfyUI/HTTP disconnect during a long Wan/FLF2V shot, not a Hermes model/toolset issue.

Fix applied on 2026-06-08:

- `generate_video.py` retries `RemoteDisconnected`, timeout, and connection reset/abort errors.
- `generate_video_sequence.py` retries a transient shot failure once before failing the whole sequence.

If it still happens repeatedly, reduce the test target first: `duration_seconds=8`, `mode=test`, then `duration_seconds=12`, `mode=quality`; check ComfyUI logs/VRAM only if both fail.
