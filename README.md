# Hermes Agent Local Media Plugin

Portable Hermes GenVideo package for a local ComfyUI + Wan2.1 video workflow.

This repo contains the agent-facing Hermes plugin, media pipeline scripts, ComfyUI API workflows, skills, and runbooks needed to recreate the working GenVideo setup on a new machine/container with the same base services.

## What Is Packaged

- `hermes-plugin/local_media/`: Hermes plugin exposing `generate_video` and `generate_video_sequence`.
- `media-pipeline/`: Python CLIs that call ComfyUI, generate keyframes, run Wan2.1 I2V/FLF2V, stitch shots, interpolate FPS, and write final MP4 files.
- `media-pipeline/workflows/`: ComfyUI API JSON workflows for Flux, Animagine, Wan I2V, and Wan FLF2V.
- `skills/local-comfy-wan-video/`: compact Hermes skill plus references for operating the pipeline.
- `scripts/`: install, verify, restart, and smoke-test helpers.
- `docs/`: setup, model, operations, troubleshooting, and handoff notes.

## What Is Not Packaged

Large model files and runtime data are intentionally excluded:

- ComfyUI model weights such as Animagine, Wan, Flux, RIFE.
- Generated videos/images/keyframes.
- Hermes tokens, Telegram credentials, LM Studio config, logs, sessions.
- Docker images/volumes.

## Expected Runtime Layout

```text
Hermes source:       /workspace/hermes-agent
Hermes home:         /opt/data/hermes
Plugin target:       /workspace/hermes-agent/plugins/local_media
Pipeline target:     /workspace/projects/media-pipeline
ComfyUI endpoint:    http://host.docker.internal:8188
Wan2.1 endpoint:     http://host.docker.internal:8010
LM Studio endpoint:  http://host.docker.internal:1234/v1
Generated videos:    /opt/data/hermes/generated-videos
Sequences/manifests: /opt/data/hermes/media-sequences
```

## Fast Install On A New Hermes Container

From inside the cloned repo in the Hermes container:

```bash
bash scripts/install_into_hermes.sh
bash scripts/verify_genvideo_env.sh
bash scripts/restart_hermes_gateway.sh
```

Then run a keyframe-only visual review before any full Wan render:

```bash
bash scripts/smoke_test_keyframes.sh
```

If the contact sheet looks clean, run the short video smoke test:

```bash
bash scripts/smoke_test_video.sh
```

## Agent Bootstrap

If handing this repo to a new coding agent, start with:

```text
Read docs/AGENT_BOOTSTRAP_PROMPT.md and execute the setup/verification plan. Do not download or commit model weights. Do not delete Docker volumes. Do not run full Wan renders until keyframe-only contact sheet passes visual review.
```

## Main Docs

- `docs/INSTALL_FOR_NEW_AGENT.md`: step-by-step install sequence.
- `docs/REQUIRED_MODELS.md`: model names, expected ComfyUI folders, and verification commands.
- `docs/HERMES_PROFILE_CONFIG.md`: minimal Hermes GenVideo profile/toolset config.
- `docs/OPERATIONS.md`: normal commands for start/status/test.
- `docs/TROUBLESHOOTING.md`: known root causes and fixes encountered during bring-up.
- `docs/QUALITY_WORKFLOW.md`: current quality workflow and keyframe-first rule.
