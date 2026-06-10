# Agent Bootstrap Prompt

Use this prompt for a new agent in a fresh environment.

```text
You are responsible for installing and validating the Hermes GenVideo workflow from this repository.

Goal:
Enable Hermes to receive a Telegram request, call the local generate_video_sequence tool, render a video through ComfyUI + Wan2.1, and return the result as a Telegram MEDIA attachment.

Assumptions:
- The machine has the same base services as the source environment: Hermes, ComfyUI, Wan2.1, LM Studio, Docker, RTX GPU access, and the required model files already available or installable by the user.
- Do not delete Docker volumes.
- Do not run docker system prune.
- Do not mount docker.sock into containers.
- Do not commit model weights, generated media, secrets, logs, or runtime sessions.
- Do not run long/full quality renders until the keyframe-only contact sheet passes visual review.

Required first actions:
1. Read README.md.
2. Read docs/INSTALL_FOR_NEW_AGENT.md.
3. Read docs/REQUIRED_MODELS.md.
4. Run bash scripts/install_into_hermes.sh from the repo root.
5. Run bash scripts/verify_genvideo_env.sh and report any missing model/service.
6. Restart Hermes gateway with bash scripts/restart_hermes_gateway.sh.
7. Run bash scripts/smoke_test_keyframes.sh.
8. Ask the user to visually review the generated contact sheet.
9. Only after user approval, run bash scripts/smoke_test_video.sh or ask Hermes to call generate_video_sequence with existing_keyframe_dir if approved keyframes already exist.

Acceptance criteria:
- Plugin local_media is discoverable by Hermes.
- Tools generate_video and generate_video_sequence are registered.
- ComfyUI /system_stats is reachable and reports CUDA GPU.
- ComfyUI exposes animagine-xl-3.1.safetensors in CheckpointLoaderSimple.
- ComfyUI exposes rife_v4.26.safetensors in FrameInterpolationModelLoader.
- Wan2.1 endpoint /health reports CUDA available and model_dir_exists true.
- Keyframe-only sequence writes a manifest and contact sheet with no validator errors.
- Short smoke video writes an MP4 under /opt/data/hermes/generated-videos and a manifest under /opt/data/hermes/media-sequences.
- Telegram delivery uses exact MEDIA:/absolute/path.mp4 from the manifest/tool result. Do not rewrite hyphens/underscores in file names.
```
