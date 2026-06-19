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

## LTX-2.3 22B fp8 OOM At KSampler (RTX 3090)

Symptom: `generate_ltx_video.py` returns `GPU OOM while running LTX-2.3`. ComfyUI
history shows the error at node `KSampler` (`torch.OutOfMemoryError`) with the
traceback ending in
`comfy_kitchen/backends/eager/quantization.py:calc_mantissa` → `torch.where`.

This persists even with `--lowvram`, LM Studio fully closed, and ~24GB VRAM free.

Root cause: the model loads fine (~16GB); the OOM is the fp8 **stochastic
rounding** in ComfyUI's `comfy_kitchen` eager backend. Quantizing each weight
allocates 5-7 large temporary tensors, so the largest FFN weights push peak VRAM
past 24GB. `--lowvram` cannot help because the spike is per-weight quantization,
not the resident model.

Fix: disable stochastic rounding in the `gen-media-comfy` container. Edit
`/opt/ComfyUI/comfy/ops.py` (~line 1261), change `stochastic_rounding=seed` to
`stochastic_rounding=0`.

> Use `0`, NOT `None`. `quant_ops.py:96` does `if stochastic_rounding > 0`, and
> `None > 0` raises `TypeError: '>' not supported between 'NoneType' and 'int'`.

```bash
docker exec gen-media-comfy sed -i \
  's/stochastic_rounding=seed/stochastic_rounding=0/' \
  /opt/ComfyUI/comfy/ops.py
docker exec gen-media-comfy sed -n '1259,1263p' /opt/ComfyUI/comfy/ops.py  # verify
docker restart gen-media-comfy
```

Stochastic rounding only matters for training; for inference the quality impact
is negligible. After the fix, verified clean: `mode=test` ~350s, `mode=standard`
~376s, 2-shot `independent` sequence ~753s (10.25s stitched output), no OOM.

> WARNING: this edit lives in the container's writable layer and is LOST when the
> container is recreated (e.g. when re-adding `--lowvram` or other run flags).
> Re-apply the `sed` + `restart` above after every `docker rm` / recreate of
> `gen-media-comfy`. The named volumes (models, custom_nodes, input, output,
> cache) survive recreate; this code patch does not.

`gen-media-comfy` was created with `docker run` (no compose file). To recreate it
with `--lowvram` while preserving data:

```bash
docker stop gen-media-comfy && docker rm gen-media-comfy
docker run -d --name gen-media-comfy --gpus all \
  -p 127.0.0.1:8188:8188 \
  -e PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512,garbage_collection_threshold:0.6 \
  -v genmedia-comfy-models:/opt/ComfyUI/models \
  -v genmedia-comfy-custom-nodes:/opt/ComfyUI/custom_nodes \
  -v genmedia-comfy-input:/input \
  -v genmedia-comfy-output:/output \
  -v genmedia-comfy-cache:/root/.cache \
  --restart unless-stopped \
  gen-media-comfy:gpu \
  python main.py --listen 0.0.0.0 --port 8188 \
    --input-directory /input --output-directory /output --lowvram
# then re-apply the ops.py patch above
```
