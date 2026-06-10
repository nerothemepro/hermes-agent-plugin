# Required Models

Model files are not committed to this repo. Install them into the running ComfyUI/Wan environment and restart the relevant service.

## ComfyUI Checkpoints

### Animagine SDXL Keyframes

Purpose: high-quality anime keyframe generation.

Expected ComfyUI path:

```text
/opt/ComfyUI/models/checkpoints/animagine-xl-3.1.safetensors
```

Verify from Hermes container:

```bash
curl -s http://host.docker.internal:8188/object_info/CheckpointLoaderSimple | jq -r '.CheckpointLoaderSimple.input.required.ckpt_name[0][]?'
```

Expected includes:

```text
animagine-xl-3.1.safetensors
```

### Flux Fallback Keyframes

Purpose: fallback/general keyframe generation.

The current environment exposes:

```text
flux1-schnell-fp8.safetensors
```

## Wan2.1 Video Models

Purpose: I2V/FLF2V video generation.

Verify:

```bash
curl -s http://host.docker.internal:8188/object_info/WanFirstLastFrameToVideo | head -c 500
curl -s http://host.docker.internal:8188/object_info/WanImageToVideo | head -c 500
curl -s http://host.docker.internal:8010/health
```

Expected Wan API health includes:

```json
{"cuda_available": true, "model_dir_exists": true}
```

## RIFE Frame Interpolation

Purpose: smoother final FPS from low-FPS Wan output.

Expected ComfyUI path:

```text
/opt/ComfyUI/models/frame_interpolation/rife_v4.26.safetensors
```

Verify:

```bash
curl -s http://host.docker.internal:8188/object_info/FrameInterpolationModelLoader | jq -r '.FrameInterpolationModelLoader.input.required.model_name[1].options[]?'
```

Expected:

```text
rife_v4.26.safetensors
```

Known good SHA256 from the source environment:

```text
151874592c877740e5db11522f4514df569eeafb0a0fcb2696f16e9e8d317c94
```

If ComfyUI shows the model but interpolation fails with `invalid JSON in header`, the file is corrupt/truncated. Copy it again and verify SHA256 inside the ComfyUI container.

## Do Not Commit

Never commit model weights, generated media, downloaded model caches, secrets, or logs.
