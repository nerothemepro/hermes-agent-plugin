# HerVid LTX-2.3 Implementation Plan

## Objective

Implement a deterministic HerVid path for LTX-2.3 Image-to-Video generation:

1. Generate or select a keyframe image.
2. Run the local ComfyUI LTX-2.3 I2V workflow through API/CLI, not UI automation.
3. Save the final MP4 under `/opt/data/hermes/generated-videos/`.
4. Expose the workflow as Hermes local media tools.
5. Let HerVid return the final result through Telegram using `MEDIA:/absolute/path.mp4`.

This plan is implementation-ready. It intentionally does not include code.

## Non-Goals

- Do not automate ComfyUI with browser/UI actions.
- Do not default to `1280x720`.
- Do not attempt long single-shot renders over 5 seconds in the first implementation.
- Do not replace the existing Wan2.1 pipeline.
- Do not implement multi-shot LTX sequence until the single-shot CLI and HerVid tool path pass acceptance.

## Current Verified Runtime

ComfyUI endpoint:

```text
http://host.docker.internal:8188
```

Required LTX-2.3 model files are available in ComfyUI:

```text
/opt/ComfyUI/models/checkpoints/ltx-2.3-22b-dev-fp8.safetensors
/opt/ComfyUI/models/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors
/opt/ComfyUI/models/loras/gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors
/opt/ComfyUI/models/latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors
/opt/ComfyUI/models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors
```

Validated constraint:

- `1280x720`, `5s`, `25fps`, prompt enhance enabled can cause GPU OOM.
- A 3-second low-setting run has succeeded.

## Files To Add

### `projects/media-pipeline/generate_ltx_video.py`

Primary CLI for LTX I2V.

Responsibilities:

- Accept prompt, input image, mode, resolution, duration, fps, prompt enhance flag, timeout.
- Validate input image path exists.
- Upload/copy input image into ComfyUI input if needed.
- Build ComfyUI API prompt from the LTX-2.3 workflow template.
- Submit workflow to `/prompt`.
- Poll `/history/{prompt_id}` until done or timeout.
- Download/fetch final video from ComfyUI output using the correct output metadata.
- Save final MP4 to `/opt/data/hermes/generated-videos/`.
- Return JSON only on stdout.

Required CLI arguments:

```text
--prompt TEXT
--input-image PATH
--mode test|standard|quality
--width INT
--height INT
--duration INT
--fps INT
--prompt-enhance true|false
--timeout-seconds INT
--output-dir PATH
```

Defaults:

```text
mode=test
width=768
height=512
duration=3
fps=16
prompt_enhance=false
timeout_seconds=1800
output_dir=/opt/data/hermes/generated-videos
```

Expected JSON:

```json
{
  "status": "completed",
  "workflow": "ltx-2.3-i2v",
  "video_path": "/opt/data/hermes/generated-videos/example.mp4",
  "input_image_path": "/opt/data/hermes/generated-images/example.png",
  "prompt": "final prompt used",
  "settings": {
    "mode": "test",
    "width": 768,
    "height": 512,
    "duration": 3,
    "fps": 16,
    "prompt_enhance": false
  },
  "comfyui": {
    "prompt_id": "...",
    "output_ref": {
      "filename": "...",
      "subfolder": "...",
      "type": "output"
    }
  },
  "warnings": [],
  "errors": []
}
```

Failure JSON:

```json
{
  "status": "error",
  "workflow": "ltx-2.3-i2v",
  "video_path": null,
  "warnings": [],
  "errors": ["..."],
  "debug_artifacts": {
    "prompt_json": "...",
    "history_json": "..."
  }
}
```

### `projects/media-pipeline/generate_image.py`

Keyframe generation CLI.

Responsibilities:

- Generate one still image suitable as LTX first frame.
- Use existing ComfyUI image generation patterns where possible.
- Prefer Flux for realistic/product/travel/social ad styles.
- Prefer Animagine only for anime/illustration styles.
- Save output under `/opt/data/hermes/generated-images/`.
- Return JSON only on stdout.

Required CLI arguments:

```text
--prompt TEXT
--style realistic|product|travel|social_ad|anime
--engine auto|flux|animagine
--width INT
--height INT
--timeout-seconds INT
--output-dir PATH
```

Defaults:

```text
engine=auto
style=realistic
width=768
height=512
timeout_seconds=900
output_dir=/opt/data/hermes/generated-images
```

Expected JSON:

```json
{
  "status": "completed",
  "image_path": "/opt/data/hermes/generated-images/example.png",
  "engine": "flux",
  "prompt": "final image prompt",
  "settings": {
    "width": 768,
    "height": 512
  },
  "warnings": [],
  "errors": []
}
```

### `projects/media-pipeline/workflows/ltx_2_3_i2v_api.json`

API-compatible ComfyUI workflow template derived from:

```text
/workspace/screenshot/hermes/videos/video_ltx2_3_i2v.json
```

Responsibilities:

- Remove UI-only fields.
- Keep only prompt/API node graph.
- Expose placeholder values for:
  - input image
  - prompt
  - width
  - height
  - duration
  - fps
  - seed
  - prompt enhance
  - model names
- Preserve model defaults:

```text
ckpt_name=ltx-2.3-22b-dev-fp8.safetensors
distilled_lora=ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors
text_encoder=gemma_3_12B_it_fp4_mixed.safetensors
latent_upscale_model=ltx-2.3-spatial-upscaler-x2-1.1.safetensors
lora=gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors
```

### Optional `projects/media-pipeline/ltx_workflow_adapter.py`

Use this helper only if the API prompt conversion logic is too large for `generate_ltx_video.py`.

Responsibilities:

- Load the API template.
- Patch node inputs safely.
- Validate required node IDs/classes exist.
- Return final prompt JSON.

## Files To Change

### `hermes-agent/plugins/local_media/tools.py`

Expose Hermes tools:

- `generate_image`
- `generate_ltx_video`

If a generic `generate_video` already exists, do not overload it silently. Add explicit LTX tool names or a clear `engine=ltx` field.

Suggested `generate_ltx_video` schema:

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Video prompt or scene description."
    },
    "mode": {
      "type": "string",
      "enum": ["test", "standard", "quality"],
      "default": "test"
    },
    "style": {
      "type": "string",
      "enum": ["realistic", "product", "travel", "social_ad", "anime"],
      "default": "realistic"
    },
    "duration_seconds": {
      "type": "integer",
      "default": 3,
      "minimum": 1,
      "maximum": 5
    },
    "aspect_ratio": {
      "type": "string",
      "enum": ["16:9", "9:16", "1:1"],
      "default": "16:9"
    },
    "input_image_path": {
      "type": "string",
      "description": "Optional existing keyframe image path."
    },
    "generate_keyframe": {
      "type": "boolean",
      "default": true
    },
    "prompt_enhance": {
      "type": "boolean",
      "default": false
    },
    "timeout_seconds": {
      "type": "integer",
      "default": 1800,
      "minimum": 60,
      "maximum": 7200
    }
  },
  "required": ["prompt"],
  "additionalProperties": false
}
```

Tool handler behavior:

1. If `generate_keyframe=true` and no `input_image_path`, call `generate_image.py`.
2. Call `generate_ltx_video.py` with the generated or supplied image.
3. Return the JSON from the CLI plus a convenience `media_path` field:

```json
{
  "media_path": "MEDIA:/opt/data/hermes/generated-videos/example.mp4"
}
```

### HerVid Profile/Skill

Update the HerVid profile or skill instructions:

```text
For LTX-2.3 video generation:
- Use generate_ltx_video for LTX I2V requests.
- Always create/select a strong keyframe first.
- Do not use ComfyUI browser/UI automation.
- Default to mode=test or mode=standard, never 1280x720.
- If the user asks for more than 5 seconds, explain that single-shot LTX is limited and use/offer multi-shot generation after the sequence tool is implemented.
- Always send final MP4 with MEDIA:/absolute/path.
```

## Mode Presets

Centralize presets in `generate_ltx_video.py`:

```python
PRESETS = {
    "test": {
        "width": 768,
        "height": 512,
        "duration": 3,
        "fps": 16,
        "prompt_enhance": False,
    },
    "standard": {
        "width": 768,
        "height": 512,
        "duration": 5,
        "fps": 16,
        "prompt_enhance": False,
    },
    "quality": {
        "width": 1024,
        "height": 576,
        "duration": 5,
        "fps": 24,
        "prompt_enhance": False,
    },
}
```

Do not enable `prompt_enhance=true` by default until memory behavior is verified.

## OOM Handling

`generate_ltx_video.py` must detect common OOM messages:

```text
Allocation on device
out of memory
CUDA out of memory
```

On OOM:

1. Mark the run as `error`.
2. Include `oom_detected=true`.
3. Suggest lower settings in `warnings`.
4. Do not retry indefinitely.

Optional single retry:

- If mode is `standard`, retry once using `test`.
- If mode is `quality`, retry once using `standard`.
- Record retry in JSON:

```json
{
  "warnings": ["OOM at quality preset; retried with standard preset."]
}
```

## ComfyUI API Execution Contract

Recommended helper functions:

```python
submit_prompt(prompt_json) -> prompt_id
poll_history(prompt_id, timeout_seconds) -> history_json
extract_video_ref(history_json) -> {filename, subfolder, type}
download_comfy_output(ref, output_path) -> output_path
```

Important:

- Do not construct output paths directly from filename/subfolder alone.
- Use ComfyUI `/view` endpoint with `filename`, `subfolder`, and `type`.
- Save the downloaded MP4 into `/opt/data/hermes/generated-videos/`.

This mirrors the existing Wan2.1 fix and prevents Telegram delivery failures.

## Keyframe Prompting Rules

For generated keyframes:

- Prefer one clear subject and one clear action cue.
- Avoid crowded scenes.
- Avoid text/logos/watermarks.
- For product videos, make the object large and centered.
- For travel/social videos, make camera motion easy for LTX to infer.
- For anime, only use Animagine if the user explicitly wants anime.

Example product keyframe prompt:

```text
cinematic product photo of a hot coffee cup on a wooden table, soft morning sunlight, visible steam, clean background, high detail, warm atmosphere, no text, no watermark
```

Example video prompt:

```text
Steam rises gently from the hot coffee cup as the camera slowly pushes in. Morning sunlight moves softly across the wooden table. Natural realistic motion, stable composition, no text, no watermark.
```

## Verification Commands

Static checks:

```bash
python3 -m py_compile \
  /workspace/projects/media-pipeline/generate_image.py \
  /workspace/projects/media-pipeline/generate_ltx_video.py \
  /workspace/hermes-agent/plugins/local_media/tools.py
```

ComfyUI model checks:

```bash
curl -s http://host.docker.internal:8188/object_info/CheckpointLoaderSimple | jq -r '.CheckpointLoaderSimple.input.required.ckpt_name[0][]?' | grep 'ltx-2.3-22b-dev-fp8'

curl -s http://host.docker.internal:8188/object_info/LoraLoader | jq -r '.LoraLoader.input.required.lora_name[0][]?' | grep -E 'ltx_2.3|gemma-3-12b'

curl -s http://host.docker.internal:8188/object_info/LTXAVTextEncoderLoader | jq -r '.LTXAVTextEncoderLoader.input.required.text_encoder[1].options[]?' | grep 'gemma_3_12B'

curl -s http://host.docker.internal:8188/object_info/LatentUpscaleModelLoader | jq -r '.LatentUpscaleModelLoader.input.required.model_name[1].options[]?' | grep 'ltx-2.3-spatial'
```

Keyframe smoke:

```bash
python3 /workspace/projects/media-pipeline/generate_image.py \
  --prompt "cinematic product photo of a hot coffee cup on a wooden table, soft morning sunlight, visible steam, no text, no watermark" \
  --style product \
  --engine flux \
  --width 768 \
  --height 512
```

LTX smoke with existing image:

```bash
python3 /workspace/projects/media-pipeline/generate_ltx_video.py \
  --prompt "Steam rises gently from the hot coffee cup as the camera slowly pushes in. Morning sunlight moves softly across the wooden table. Natural realistic motion, stable composition, no text, no watermark." \
  --input-image /opt/data/hermes/generated-images/<image>.png \
  --mode test \
  --width 768 \
  --height 512 \
  --duration 3 \
  --fps 16 \
  --prompt-enhance false
```

Hermes tool smoke:

```text
Use generate_ltx_video to create a 3 second product video of a hot coffee cup on a wooden table in soft morning sunlight. Use mode=test, style=product, generate_keyframe=true. Send the result using MEDIA path.
```

## Acceptance Criteria

Phase 1:

- `generate_ltx_video.py` renders a 3-second video from an existing input image.
- The output MP4 exists under `/opt/data/hermes/generated-videos/`.
- The JSON output includes `status=completed`, `video_path`, `settings`, and `comfyui.prompt_id`.
- OOM errors return structured JSON instead of silent failure.

Phase 2:

- `generate_image.py` creates a keyframe image under `/opt/data/hermes/generated-images/`.
- The generated keyframe works as input for `generate_ltx_video.py`.

Phase 3:

- HerVid exposes `generate_ltx_video`.
- Telegram request can trigger the full keyframe + LTX video path.
- HerVid sends `MEDIA:/opt/data/hermes/generated-videos/<file>.mp4`.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| GPU OOM | Default to 768x512, 3-5s, 16fps, prompt enhance off. |
| ComfyUI workflow API conversion complexity | Store a clean API template and patch known node inputs only. |
| Bad keyframe causes bad video | Generate keyframe first and optionally expose keyframe-only inspection. |
| Telegram delivery fails due ComfyUI output path mismatch | Always download through `/view` into `/opt/data/hermes/generated-videos/`. |
| Long videos degrade or OOM | Add multi-shot sequence only after single-shot is stable. |
| HerVid overuses LTX for anime action | Keep Wan2.1/anime path separate; use LTX first for product/social/cinematic clips. |

## Implementation Order

1. Add `ltx_2_3_i2v_api.json`.
2. Add `generate_ltx_video.py` with existing-image input only.
3. Run LTX 3-second smoke test.
4. Add/standardize `generate_image.py`.
5. Run keyframe + LTX smoke test.
6. Expose `generate_ltx_video` in local media plugin.
7. Restart HerVid gateway.
8. Test Telegram request.
9. Only after acceptance, plan `generate_ltx_video_sequence.py`.

## Open Questions

- Which existing image-generation workflow should be the default for Flux keyframes?
- Should `generate_image.py` reuse current `generate_video.py --keyframe-only` code, or become a clean dedicated CLI?
- Does HerVid currently load a skill/profile file where LTX runtime rules should be persisted?
- Should `quality` preset use `1024x576` or stay at `768x512` until more VRAM tests pass?

