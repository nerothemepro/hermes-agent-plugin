# Hermes Agent Local Media Plugin

Local video generation tooling for a Hermes Agent profile using ComfyUI and Wan2.1.

This repository contains:

- `media-pipeline/`: CLI scripts that call ComfyUI workflows, generate keyframes, render Wan2.1 I2V/FLF2V shots, stitch multi-shot videos, and write final MP4 outputs.
- `hermes-plugin/local_media/`: Hermes plugin wrapper exposing `generate_video` and `generate_video_sequence` tools.
- `docs/`: operational notes and improvement plan for the local GenVideo workflow.

The default local endpoints expected by the scripts are:

```text
ComfyUI: http://host.docker.internal:8188
Wan2.1 fallback API: http://host.docker.internal:8010
Outputs: /opt/data/hermes/generated-videos
```

No model weights, generated videos, logs, tokens, or private runtime config are included.

## Quick Smoke Test

From a Hermes/container environment with ComfyUI and models already running:

```bash
python3 media-pipeline/generate_video_sequence.py   --prompt "two original anime samurai warriors fight in a moonlit bamboo forest, readable sword choreography, no text, no watermark, no gore"   --duration-seconds 8   --mode test   --style-preset anime_action   --control-mode flf2v   --postprocess ffmpeg_fps   --target-fps 16   --shot-count 4   --frames-per-shot 17   --wan-steps-per-shot 2
```

For full environment setup and known failure modes, see `docs/HERMES_GENVIDEO_RUNBOOK.md`.
