# HerVid LTX-2.3 Controller Specification

> **Scope**: Planning artifact only. No code implementation.
> **Date**: 2026-06-16
> **Status**: DRAFT — ready for implementation pass
> **Reference**: `docs/HERVID_LTX_2_3_VIDEO_PIPELINE_PLAN.md`

---

## 1. Overview

This spec defines the controller contract for adding LTX-2.3 video generation to HerVid. LTX-2.3 is a separate model family from the existing Wan2.1 pipeline. The controller exposes deterministic CLI tools that wrap ComfyUI API calls, returning structured JSON and stable output paths. HerVid consumes these tools via the `local_media` plugin and delivers output through Telegram using the `MEDIA:/` directive.

### 1.1 What LTX-2.3 Adds

- A new I2V model (`ltx-2.3-22b-dev-fp8`) with distilled LoRA, spatial upscaler, and Gemma-3 text encoder.
- VRAM-safe presets for RTX 3090 (24 GB) that avoid OOM at default settings.
- A complementary video generation path alongside the existing Wan2.1 pipeline (not a replacement).

### 1.2 What LTX-2.3 Does NOT Replace

- Wan2.1 remains the primary video engine for anime action sequences and multi-shot workflows.
- LTX-2.3 targets realistic/cinematic/product/travel/social-ad single-shot and short-sequence videos.

---

## 2. User-Facing HerVid Workflow

```
User sends video request on Telegram
  -> HerVid analyzes request, decides LTX vs Wan route
     (LTX chosen for realistic/product/cinematic prompts)
  -> HerVid calls generate_ltx_video tool
     -> tool generates keyframe image (Flux) if needed
     -> tool runs LTX-2.3 I2V ComfyUI workflow
     -> tool returns JSON with video_path
  -> HerVid sends MEDIA:/opt/data/hermes/generated-videos/<slug>.mp4
```

For multi-shot LTX sequences (>5 seconds):

```
User sends video request > 5 seconds
  -> HerVid calls generate_ltx_video_sequence tool
     -> tool splits into 3-5s shots
     -> tool generates keyframe per shot
     -> tool runs LTX-2.3 I2V per shot
     -> tool concatenates with ffmpeg
     -> tool returns JSON with final_video_path + manifest
  -> HerVid sends MEDIA:/opt/data/hermes/generated-videos/<slug>-final.mp4
```

---

## 3. Tool Boundaries

### 3.1 CLI Tools (media-pipeline layer)

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `media-pipeline/generate_ltx_video.py` | Single-shot LTX-2.3 I2V render | prompt, input image, mode, resolution, duration, fps | JSON with `video_path` |
| `media-pipeline/generate_ltx_video_sequence.py` | Multi-shot LTX-2.3 sequence | prompt, duration, mode, shot count | JSON with `final_video_path` + manifest |

### 3.2 Hermes Plugin Tools (agent-facing layer)

| Tool Name | Handler | Schema | Description |
|-----------|---------|--------|-------------|
| `generate_ltx_video` | `handle_generate_ltx_video` | `GENERATE_LTX_VIDEO_SCHEMA` | Single-shot LTX video generation |
| `generate_ltx_video_sequence` | `handle_generate_ltx_video_sequence` | `GENERATE_LTX_VIDEO_SEQUENCE_SCHEMA` | Multi-shot LTX video sequence |

### 3.3 Separation of Concerns

- **CLI scripts**: ComfyUI API communication, workflow JSON construction, file I/O, error handling. Return structured JSON on stdout.
- **Plugin tools**: Argument coercion, CLI invocation, JSON parsing, path verification, result formatting. Use `tool_result()` and `tool_error()` from `tools.registry`.
- **HerVid skill/profile**: Prompt analysis, tool selection, MEDIA delivery.

---

## 4. CLI Inputs / Outputs

### 4.1 `generate_ltx_video.py` — CLI Arguments

```
--prompt <string>           Required. Visual description for the video.
--input-image <path>        Optional. Existing keyframe image. If omitted, a keyframe is generated via Flux.
--mode <test|standard|quality>  Rendering preset. Default: standard.
--width <int>              Override width. Default per mode preset.
--height <int>             Override height. Default per mode preset.
--duration <int>           Video duration in seconds. Default per mode preset.
--fps <int>                Frames per second. Default per mode preset.
--prompt-enhance <bool>    Enable prompt enhancement. Default per mode preset.
--env-file <path>          Optional env file path.
--seed <int>               Optional deterministic seed.
```

### 4.2 `generate_ltx_video.py` — JSON Output Schema

```json
{
  "status": "completed",
  "workflow": "ltx-2.3-i2v",
  "video_path": "/opt/data/hermes/generated-videos/<slug>.mp4",
  "image_path": "/opt/data/hermes/generated-images/<slug>-keyframe.png",
  "settings": {
    "width": 768,
    "height": 512,
    "duration": 3,
    "fps": 16,
    "prompt_enhance": false,
    "seed": 12345
  },
  "keyframe_engine": "flux",
  "comfyui": {
    "prompt_id": "abc123",
    "queue_time_seconds": 2.1,
    "render_time_seconds": 45.3
  },
  "warnings": [],
  "errors": []
}
```

On failure:

```json
{
  "status": "failed",
  "workflow": "ltx-2.3-i2v",
  "video_path": null,
  "image_path": null,
  "settings": { ... },
  "warnings": ["GPU OOM detected, retry with lower settings"],
  "errors": ["CUDA out of memory with 768x512 @ 5s"]
}
```

### 4.3 `generate_ltx_video_sequence.py` — CLI Arguments

```
--prompt <string>           Required.
--duration-seconds <int>    Total video duration. Default: 10. Clamped to 6-30.
--mode <test|standard|quality>  Rendering preset. Default: standard.
--shot-count <int>          Optional explicit shot count. Auto-calculated if omitted.
--env-file <path>          Optional env file path.
--seed <int>               Optional deterministic seed.
```

### 4.4 `generate_ltx_video_sequence.py` — JSON Output Schema

```json
{
  "status": "completed",
  "workflow": "ltx-2.3-sequence",
  "final_video_path": "/opt/data/hermes/generated-videos/<slug>-final.mp4",
  "manifest_path": "/opt/data/hermes/generated-videos/<slug>-manifest.json",
  "shots": [
    {
      "index": 1,
      "prompt": "...",
      "image_path": "/opt/data/hermes/generated-images/<slug>-shot-01-keyframe.png",
      "video_path": "/opt/data/hermes/generated-videos/<slug>-shot-01.mp4",
      "duration": 3
    }
  ],
  "settings": {
    "width": 768,
    "height": 512,
    "fps": 16,
    "shot_count": 2,
    "total_duration": 6
  },
  "warnings": [],
  "errors": []
}
```

---

## 5. Mode Presets

| Parameter | test | standard | quality |
|-----------|------|----------|---------|
| width | 768 | 768 | 1024 |
| height | 512 | 512 | 576 |
| duration (seconds) | 3 | 5 | 5 |
| fps | 16 | 16 | 24 |
| prompt_enhance | false | false | true (if VRAM stable) |
| keyframe_engine | flux | flux | flux |
| lora_strength | 0.0 (disabled) | 0.8 | 0.8 |
| max_retries | 0 | 1 | 1 |

### 5.1 Preset Rationale

- **test**: Fastest settings for plumbing verification. Minimal VRAM usage.
- **standard**: Balanced quality/speed for typical user requests.
- **quality**: Higher resolution and frame rate for best output. Prompt enhance only if VRAM remains stable (checked via a pre-flight VRAM probe).

### 5.2 Resolution Safety

The default resolution is **never** 1280x720. All presets use dimensions that fit within 24 GB VRAM on RTX 3090 with the LTX-2.3 22B fp8 model + LoRA + Gemma-3 text encoder loaded simultaneously.

---

## 6. Fallback Behavior for OOM

### 6.1 Detection

OOM is detected via:
1. ComfyUI returning HTTP 500 with error message containing "CUDA out of memory" or "CudaErrorOutOfMemory".
2. ComfyUI queue showing `status_str: "error"` with GPU memory in the error detail.
3. Child process returning non-zero exit code with OOM keywords in stderr.

### 6.2 Retry Strategy

```
Attempt 1: original settings
  -> OOM detected?
    -> Attempt 2: reduce width by 256, reduce height by 128, reduce duration by 1 second, disable prompt_enhance
      -> OOM again?
        -> Return failure with clear error: "LTX-2.3 render failed after OOM retry at reduced resolution"
        -> Suggest user try mode=test or a shorter duration
```

- Maximum retries: **1** (configured per mode preset).
- No silent fallback to a different model.
- All retry attempts logged in `warnings` array.

### 6.3 VRAM Pre-Flight Probe (quality mode only)

Before running quality mode, the controller checks:
1. ComfyUI `/system_stats` endpoint is reachable.
2. No other long-running prompt is in the queue (`/queue` returns empty running list).
3. If queue is busy, wait up to 60 seconds or return "ComfyUI busy" error.

---

## 7. Output Path Contract

### 7.1 Directory Structure

```
/opt/data/hermes/generated-images/
  <slug>-keyframe.png              # Single-shot keyframe
  <slug>-shot-01-keyframe.png      # Sequence shot keyframes
  <slug>-shot-02-keyframe.png

/opt/data/hermes/generated-videos/
  <slug>.mp4                       # Single-shot video
  <slug>-shot-01.mp4               # Sequence individual shots
  <slug>-shot-02.mp4
  <slug>-final.mp4                 # Sequence concatenated final
  <slug>-manifest.json             # Sequence manifest

/opt/data/hermes/media-sequences/  # Temp work directory for sequence processing
  <slug>/
    concat.txt                     # ffmpeg concat list
    intermediate frames
```

### 7.2 Slug Generation

- Same `slugify()` function as existing Wan pipeline: lowercase, alphanumeric + hyphens, max 52 chars.
- Derived from the user prompt.
- UUID suffix added only on collision (same slug within last 24 hours).

### 7.3 Path Verification

Plugin tools verify:
1. `video_path` is absolute.
2. `video_path` is inside `/opt/data/hermes/generated-videos/` (the only allowed output directory).
3. File exists, is non-empty, and has a valid video extension (`.mp4`).
4. Same verification pattern as `_verify_video_path()` in existing `tools.py`.

---

## 8. Telegram MEDIA Delivery Contract

### 8.1 Tool Return Format

On success, the plugin tool returns:

```json
{
  "success": true,
  "status": "completed",
  "video_path": "/opt/data/hermes/generated-videos/coffee-cup.mp4",
  "media": "MEDIA:/opt/data/hermes/generated-videos/coffee-cup.mp4",
  "send_to_user": "MEDIA:/opt/data/hermes/generated-videos/coffee-cup.mp4",
  "size_bytes": 2458624,
  "mode": "standard",
  "note": "Send the media field verbatim to deliver the video on Telegram."
}
```

### 8.2 HerVid Responsibility

HerVid (the agent skill/profile) must:
1. Read the `media` field from the tool result.
2. Emit it verbatim as `MEDIA:/absolute/path/to/video.mp4` in the Telegram response.
3. Not modify the path, not add quotes, not wrap in markdown.
4. For sequence tools, use the `final_video_path` / `media` field.

### 8.3 Size Limits

- Telegram video limit: 20 MB for photo-style, 50 MB for video messages.
- If `size_bytes` exceeds 45 MB, add a warning and suggest re-rendering in `test` or `standard` mode.
- If `size_bytes` exceeds 50 MB, return error and do not deliver.

---

## 9. Safety Constraints

### 9.1 No ComfyUI UI / Browser Automation

- All ComfyUI interaction is via HTTP API (`/prompt`, `/history`, `/queue`, `/view`, `/system_stats`).
- No Selenium, Playwright, puppeteer, or any browser automation.
- No file-system manipulation of ComfyUI's internal directories.

### 9.2 No 1280x720 Default

- The default workflow setting `1280x720, 5s, 25fps, prompt_enhance=true` causes OOM on RTX 3090.
- All mode presets use lower resolutions.
- Width/height overrides are clamped: max width=1024, max height=576.

### 9.3 Timeout Guards

- Single-shot: max 1800 seconds (30 minutes).
- Sequence: max 14400 seconds (4 hours).
- ComfyUI individual poll timeout: 900 seconds per prompt.
- If timeout expires, return clear error with partial results if available.

### 9.4 File System Isolation

- Output only to `/opt/data/hermes/generated-*` directories.
- No writes to `/opt/ComfyUI/` or any ComfyUI model directory.
- Temporary files in `/opt/data/hermes/media-sequences/` are cleaned up after success.

---

## 10. ComfyUI Node Requirements

The following nodes must be available in ComfyUI for LTX-2.3 I2V:

| Node Class | Purpose |
|------------|---------|
| `CheckpointLoaderSimple` | Load `ltx-2.3-22b-dev-fp8.safetensors` |
| `LoraLoader` / `LoraLoaderModelOnly` | Load distilled LoRA |
| `LTXAVTextEncoderLoader` | Load Gemma-3 text encoder |
| `CLIPTextEncode` | Encode positive/negative prompts |
| `LTXVPreprocess` | Preprocess input image for LTX |
| `LTXVImgToVideoInplace` | Core I2V latent generation |
| `LTXVConditioning` | Add conditioning to latent |
| `KSampler` | Sampling |
| `VAEDecode` / `VAEDecodeTiled` | Decode latent to frames |
| `CreateVideo` | Assemble frames into video |
| `SaveVideo` | Save as MP4 |
| `LTXVCropGuides` | Optional crop guidance |
| `LTXVLatentUpsampler` | Optional upscaling in quality mode |

---

## 11. Model Paths

| Model | Path |
|-------|------|
| LTX 2.3 checkpoint | `/opt/ComfyUI/models/checkpoints/ltx-2.3-22b-dev-fp8.safetensors` |
| Distilled LoRA | `/opt/ComfyUI/models/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors` |
| Gemma-3 text encoder | `/opt/ComfyUI/models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors` |
| Spatial upscaler | `/opt/ComfyUI/models/latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors` |

These paths are verified as present and accessible per the reference plan.

---

## 12. Environment Configuration

LTX-specific settings may be placed in `/opt/data/hermes/media-pipeline.env`:

```
LTX_CHECKPOINT=ltx-2.3-22b-dev-fp8.safetensors
LTX_LORA=ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors
LTX_LORA_STRENGTH=0.8
LTX_TEXT_ENCODER=gemma_3_12B_it_fp4_mixed.safetensors
LTX_UPSCALER=ltx-2.3-spatial-upscaler-x2-1.1.safetensors
LTX_DEFAULT_WIDTH=768
LTX_DEFAULT_HEIGHT=512
LTX_DEFAULT_DURATION=3
LTX_DEFAULT_FPS=16
```

---

## Appendix A: Comparison with Existing Wan2.1 Pipeline

| Aspect | Wan2.1 (existing) | LTX-2.3 (new) |
|--------|-------------------|---------------|
| CLI script | `generate_video.py` | `generate_ltx_video.py` |
| Sequence script | `generate_video_sequence.py` | `generate_ltx_video_sequence.py` |
| Plugin tool | `generate_video` | `generate_ltx_video` |
| Plugin sequence tool | `generate_video_sequence` | `generate_ltx_video_sequence` |
| Workflow JSON | `wan_i2v_api.json` | `ltx_i2v_api.json` (new) |
| Modes | test, quality | test, standard, quality |
| Primary use | Anime action, multi-shot | Realistic, cinematic, product, single-shot |
| Keyframe engine | flux, animagine | flux only |
| VRAM profile | Moderate | Higher (22B model) |

---

## Appendix B: Glossary

- **I2V**: Image-to-Video. Takes a keyframe image + text prompt, generates a short video.
- **LTX-2.3**: Latency-Targeted eXtended video model, 22B parameters, fp8 quantized.
- **Keyframe**: A strong starting image that LTX uses as the first frame of the video.
- **ComfyUI API**: HTTP REST interface for queuing workflows, polling status, and downloading outputs.
- **MEDIA:/**: Hermes/Telegram delivery directive prefix for file paths.
