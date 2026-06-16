# HerVid LTX-2.3 Video Pipeline Plan

## Goal

Enable HerVid to generate short marketing/social videos through the local ComfyUI LTX-2.3 Image-to-Video workflow without requiring manual ComfyUI UI operations.

The target user flow is:

1. User sends a video request to HerVid on Telegram.
2. HerVid analyzes the request and prepares a concise script/shot concept.
3. HerVid generates or selects a strong keyframe image.
4. HerVid runs the LTX-2.3 I2V workflow with VRAM-safe settings.
5. HerVid saves the final video under `/opt/data/hermes/generated-videos/`.
6. HerVid sends the result via Telegram using `MEDIA:/absolute/path/to/video.mp4`.

## Current System State

ComfyUI has been verified to expose all required LTX-2.3 custom nodes and models.

Required nodes are available:

- `LTXVAudioVAELoader`
- `LTXVConcatAVLatent`
- `LTXVCropGuides`
- `LTXVLatentUpsampler`
- `LTXVImgToVideoInplace`
- `LTXVPreprocess`
- `LTXVAudioVAEDecode`
- `LTXVConditioning`
- `LTXVEmptyLatentAudio`
- `LTXAVTextEncoderLoader`
- `TextGenerateLTX2Prompt`
- `LatentUpscaleModelLoader`
- `LoraLoader`
- `LoraLoaderModelOnly`
- `CheckpointLoaderSimple`
- `SaveVideo`
- `CreateVideo`

Required models are available:

- `/opt/ComfyUI/models/checkpoints/ltx-2.3-22b-dev-fp8.safetensors`
- `/opt/ComfyUI/models/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors`
- `/opt/ComfyUI/models/loras/gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors`
- `/opt/ComfyUI/models/latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors`
- `/opt/ComfyUI/models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors`

Verified hardware:

- GPU: NVIDIA RTX 3090
- VRAM: 24GB

Observed constraint:

- The default workflow setting `1280x720`, `5s`, `25fps`, prompt enhance enabled can hit GPU OOM.
- A lower smoke setting has successfully generated a 3-second video.

## Design Principles

- Do not make HerVid interact with ComfyUI UI manually.
- Do not rely on browser automation for ComfyUI.
- Wrap ComfyUI workflow execution in deterministic CLI tools.
- Keep output paths stable and Telegram-friendly.
- Default to VRAM-safe settings.
- For videos longer than 5 seconds, split into multiple short shots instead of one long render.
- Always generate or select a strong keyframe before running LTX I2V.

## Proposed Architecture

```text
Telegram prompt
  -> HerVid
  -> video request analysis
  -> keyframe prompt generation
  -> generate_image.py
  -> generate_ltx_video.py
  -> /opt/data/hermes/generated-videos/<file>.mp4
  -> Telegram MEDIA:/opt/data/hermes/generated-videos/<file>.mp4
```

## Phase 1 - LTX I2V CLI

Create a deterministic CLI:

```text
projects/media-pipeline/generate_ltx_video.py
```

Purpose:

- Run the local LTX-2.3 Image-to-Video ComfyUI workflow from an input image and prompt.
- Save the output video to `/opt/data/hermes/generated-videos/`.
- Return structured JSON.

Example:

```bash
python3 /workspace/projects/media-pipeline/generate_ltx_video.py \
  --prompt "slow camera push-in on a coffee cup, steam rising gently" \
  --input-image /opt/data/hermes/generated-images/coffee_keyframe.png \
  --mode test \
  --width 768 \
  --height 512 \
  --duration 3 \
  --fps 16
```

Expected JSON:

```json
{
  "status": "completed",
  "workflow": "ltx-2.3-i2v",
  "video_path": "/opt/data/hermes/generated-videos/example.mp4",
  "input_image_path": "/opt/data/hermes/generated-images/coffee_keyframe.png",
  "settings": {
    "width": 768,
    "height": 512,
    "duration": 3,
    "fps": 16,
    "prompt_enhance": false
  },
  "warnings": [],
  "errors": []
}
```

### Phase 1 Modes

`test`:

- `width=640` or `768`
- `height=384` or `512`
- `duration=3`
- `fps=12` or `16`
- `prompt_enhance=false`

`standard`:

- `width=768`
- `height=512`
- `duration=5`
- `fps=16`
- `prompt_enhance=false` by default

`quality`:

- `width=768` or `1024`
- `height=512` or `576`
- `duration=5`
- `fps=24`
- `prompt_enhance=true` only if VRAM remains stable

Do not default to `1280x720`.

## Phase 2 - Keyframe Generation CLI

Create or standardize:

```text
projects/media-pipeline/generate_image.py
```

Purpose:

- Generate a strong keyframe image for LTX I2V.
- Save to `/opt/data/hermes/generated-images/`.
- Return structured JSON.

Supported engines:

- `flux` for realistic/cinematic/product/travel imagery.
- `animagine` for anime/illustration if needed.

Example:

```bash
python3 /workspace/projects/media-pipeline/generate_image.py \
  --prompt "cinematic product photo of a hot coffee cup on a wooden table, morning sunlight, steam rising" \
  --style product_cinematic \
  --width 768 \
  --height 512
```

Expected JSON:

```json
{
  "status": "completed",
  "image_path": "/opt/data/hermes/generated-images/coffee_keyframe.png",
  "engine": "flux",
  "settings": {
    "width": 768,
    "height": 512
  },
  "warnings": [],
  "errors": []
}
```

## Phase 3 - Hermes Plugin Integration

Expose tools to HerVid through the local media plugin:

- `generate_image`
- `generate_ltx_video`

Suggested tool schema for `generate_ltx_video`:

```json
{
  "prompt": "string",
  "mode": "test|standard|quality",
  "style": "realistic|anime|product|travel|social_ad",
  "duration_seconds": "number",
  "aspect_ratio": "16:9|9:16|1:1",
  "input_image_path": "optional string",
  "generate_keyframe": "boolean",
  "timeout_seconds": "number"
}
```

Tool behavior:

- If `input_image_path` is provided, run LTX directly.
- If `generate_keyframe=true`, generate a keyframe first, then run LTX.
- Always write outputs under `/opt/data/hermes/generated-images/` and `/opt/data/hermes/generated-videos/`.
- Return JSON with `video_path`.

HerVid must send Telegram output using:

```text
MEDIA:/opt/data/hermes/generated-videos/<file>.mp4
```

## Phase 4 - Multi-Shot LTX Sequence

For videos longer than 5 seconds, do not run one long LTX render.

Create:

```text
projects/media-pipeline/generate_ltx_video_sequence.py
```

Behavior:

1. Split user request into short shots, usually 3-5 seconds each.
2. Generate one keyframe per shot.
3. Run `generate_ltx_video.py` per shot.
4. Concatenate clips with `ffmpeg`.
5. Return a final MP4 and manifest.

Recommended limits:

- 6-10 second video: 2 shots.
- 12-15 second video: 3-4 shots.
- 20-30 second video: 5-8 shots.

Manifest:

```json
{
  "status": "completed",
  "workflow": "ltx-2.3-sequence",
  "final_video_path": "/opt/data/hermes/generated-videos/final.mp4",
  "shots": [
    {
      "index": 1,
      "prompt": "...",
      "image_path": "...",
      "video_path": "...",
      "duration": 3
    }
  ],
  "warnings": [],
  "errors": []
}
```

## HerVid Runtime Rules

Add these rules to HerVid profile/skill:

```text
For LTX-2.3 video generation:

- Always create or select a strong keyframe before running LTX I2V.
- Do not use ComfyUI UI/browser automation.
- Use deterministic CLI tools.
- Do not default to 1280x720.
- Default smoke/test settings: 768x512, 3s, 16fps, prompt_enhance=false.
- Default normal settings: 768x512, 5s, 16fps, prompt_enhance=false.
- If the user asks for more than 5 seconds, split into multiple 3-5 second shots and concatenate.
- If GPU OOM happens, retry once with lower settings.
- Always return the final video through Telegram as MEDIA:/absolute/path.
```

## Acceptance Criteria

Phase 1 acceptance:

- `generate_ltx_video.py` can render a 3-second LTX video from an existing image.
- Output JSON contains `status=completed` and a valid `video_path`.
- The video path exists and is readable.
- OOM is handled with clear error output.

Phase 2 acceptance:

- `generate_image.py` can create a keyframe image.
- The generated keyframe can be passed into `generate_ltx_video.py`.

Phase 3 acceptance:

- HerVid can call `generate_ltx_video` from Telegram.
- HerVid sends the MP4 using `MEDIA:/...`.

Phase 4 acceptance:

- A 10-15 second multi-shot video can be generated and concatenated.
- Manifest records all intermediate images/videos.

## Recommended First Test Prompt

Use a simple realistic/product prompt first:

```text
Create a 3 second cinematic video of a hot coffee cup on a wooden table in soft morning sunlight. Steam rises gently from the cup, the camera slowly pushes in, natural realistic motion, high detail, no text, no watermark.
```

Recommended tool settings:

```text
mode=test
width=768
height=512
duration=3
fps=16
prompt_enhance=false
generate_keyframe=true
style=product
```

Do not start with anime action or long videos until the LTX path is stable.

