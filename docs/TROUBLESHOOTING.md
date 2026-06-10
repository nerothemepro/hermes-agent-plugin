# Troubleshooting

## Hermes Says Render Finished But No Telegram Video Arrives

Check gateway log:

```bash
tail -160 /opt/data/hermes/logs/gateway.log
```

If you see `Skipping unsafe MEDIA directive path`, common root causes are:

- LLM rewrote the file name, often changing hyphens to underscores.
- The path does not exist.
- The path is outside the allowed local delivery directories.

Fix:

1. Read the exact path from manifest.
2. Send exact `MEDIA:/absolute/path.mp4` without editing it.
3. If needed, copy the file to a short safe path:

```bash
cp /opt/data/hermes/generated-videos/<long-file>.mp4 /opt/data/hermes/generated-videos/hermes_genvideo_latest.mp4
```

Then send:

```text
MEDIA:/opt/data/hermes/generated-videos/hermes_genvideo_latest.mp4
```

Recommended code fix: gateway should append exact MEDIA tags from tool results even if the model final response contains a different MEDIA tag.

For a new environment, apply the packaged gateway fix:

```bash
python3 scripts/patch_gateway_media_delivery.py /workspace/hermes-agent/gateway/run.py
python3 -m py_compile /workspace/hermes-agent/gateway/run.py
```

## Keyframe Validator Flags internal_dark_band

Meaning: likely manga panel/collage/split-screen layout or black separator bands.

Fix sequence:

- Use `keyframe_engine=animagine`.
- Use `keyframe_frame_mode=single_scene`.
- Use `keyframe_quality_preset=anime_action_v2`.
- Run keyframe-only first.
- Do not full-render Wan until contact sheet passes visual review.
- If a previous keyframe run was approved, reuse it with `existing_keyframe_dir`.

## seed Ignored By Hermes

Current plugin exposes `seed`, but the most reliable exact reuse path is `existing_keyframe_dir`.

## ComfyUI Model Visible But Broken

Example:

```text
safetensors_rust.SafetensorError: invalid JSON in header
```

The model file is corrupt/truncated. Recopy it and verify SHA256 inside the ComfyUI container.

## Frame Interpolation Falls Back To ffmpeg_fps

If `FrameInterpolationModelLoader` has no options or RIFE fails, the pipeline falls back to `ffmpeg_fps`. Install/reinstall `rife_v4.26.safetensors` and restart ComfyUI.

## Context Too Large / Slow Hermes

Use a narrow GenVideo profile with only clarify, messaging, and local_media. Disable memory for this profile. Do research in a separate profile.

## ComfyUI Network Is Unreachable

From Hermes container:

```bash
curl -s --connect-timeout 10 http://host.docker.internal:8188/system_stats
```

If unreachable, restart `gen-media-comfy` from the host and verify port mapping.

## Wan Health Fails

```bash
curl -s http://host.docker.internal:8010/health
```

Expected `cuda_available=true` and `model_dir_exists=true`.
