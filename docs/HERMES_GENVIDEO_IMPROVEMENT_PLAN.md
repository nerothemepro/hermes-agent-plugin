# Hermes GenVideo Improvement Plan

Last updated: 2026-06-08

## Objective

Improve the local Hermes GenVideo workflow from a working proof-of-concept into a more convincing anime action generator using the current PC stack:

```text
Telegram -> Hermes GenVideo -> local_media.generate_video_sequence -> ComfyUI -> Wan2.1 -> final MP4 MEDIA path
```

Target quality goal:

```text
Reach a visibly stronger anime action result than the current 30-40% baseline, with readable sword choreography, sharper anime frames, shorter action cuts, and smoother motion.
```

This plan does not try to copy copyrighted characters, costumes, logos, or exact scenes. The target style should remain:

```text
original Japanese shonen anime action, clean cel shading, readable katana choreography, close-ups, impact frames, elemental trails, no text, no watermark, no gore
```

## Current Baseline

Latest evaluated output:

```text
/opt/data/hermes/generated-videos/two-original-anime-samurai-warriors-fight-in-a-moonl-sequence-1780899240-2cf27ef8-16fps.mp4
```

Measured properties:

```text
duration: 16.5s
resolution: 832x480
fps: 16
size: 2.56MB
shots: 4
each source shot: 33 frames, 8fps, 4.125s
render time: about 30 minutes
```

Important finding:

```text
The final 16fps is not real motion interpolation. It is ffmpeg_fps duplication from 8fps source. mpdecimate shows roughly half the frames are duplicates.
```

Root cause of current quality limit:

1. Each quality shot is too long for action: 4.125s per Wan shot.
2. Each shot has only start/end images, so Wan must invent too much choreography.
3. FPS postprocess duplicates frames instead of interpolating motion.
4. Keyframes are only generic anime-ish, not strong storyboard/action poses.
5. The script has no anime edit pass: impact flash, speed ramp, camera shake, slash overlays, or quick cut timing.

## Implementation Principles

- Keep Hermes profile narrow. Do not add broad terminal/web tools to GenVideo profile.
- Prefer deterministic local scripts over asking the LLM to manually orchestrate many steps.
- Keep output paths under `/opt/data/hermes/generated-videos` and return `MEDIA:/absolute/path`.
- Preserve existing working `generate_video` and `generate_video_sequence` behavior unless explicitly extending it.
- Start with short tests before long renders.
- Avoid touching Docker volumes, `ai-sandbox`, or unrelated containers.

## Files To Modify

Primary pipeline:

```text
/workspace/projects/media-pipeline/generate_video.py
/workspace/projects/media-pipeline/generate_video_sequence.py
/workspace/projects/media-pipeline/workflows/*.json
```

Hermes plugin/schema:

```text
/workspace/hermes-agent/plugins/local_media/tools.py
```

Docs/runbooks:

```text
/workspace/HERMES_GENVIDEO_RUNBOOK.md
/workspace/HERMES_GENVIDEO_CONTEXT_HANDOFF.md
/opt/data/hermes/skills/creative/local-comfy-wan-video/SKILL.md
/opt/data/hermes/skills/creative/local-comfy-wan-video/references/quality-tuning.md
```

Potential new files:

```text
/workspace/projects/media-pipeline/postprocess_anime_action.py
/workspace/projects/media-pipeline/workflows/anime_keyframe_api.json
/workspace/projects/media-pipeline/README_ANIME_ACTION.md
```

## Phase 1 - Fix Sequence Timing And Shot Planning

### Goal

Make generated action sequences feel cut like anime, not like four long drifting Wan clips.

### Required Changes

1. Add explicit sequence controls to `generate_video_sequence.py`:

```text
--shot-duration-seconds
--shot-count
--frames-per-shot
--wan-steps-per-shot
--motion-profile
```

Recommended defaults for `style_preset=anime_action`:

```text
mode=test:
  shot_count: 2
  frames_per_shot: 17
  wan_steps_per_shot: 8
  source_fps: 8

mode=quality:
  shot_count: auto by duration
  target shot length: 1.5-2.5s
  frames_per_shot: 17 or 21, not 33 by default
  wan_steps_per_shot: 16-20
  source_fps: 8
```

Suggested shot count mapping:

```text
8s  -> 4 shots
12s -> 6 shots
16s -> 8 shots
20s -> 10 shots
30s -> 12-15 shots, only after shorter tests pass
```

2. Stop assuming quality means 33 frames per shot. For action, 33 frames makes each shot too slow.

3. Update storyboard templates for anime action:

```text
Shot 1: establishing stance, 1.5s
Shot 2: eye close-up, 1.0-1.5s
Shot 3: hand/katana draw, 1.0-1.5s
Shot 4: first dash, 1.5-2.0s
Shot 5: diagonal clash impact, 1.0-1.5s
Shot 6: dodge/counter, 1.5-2.0s
Shot 7: elemental slash burst, 1.5-2.0s
Shot 8: aftermath pose, 1.5-2.0s
```

4. Make final duration honest:

```text
final_duration ~= shot_count * frames_per_shot / source_fps
```

If user requests `duration_seconds=12`, do not accidentally generate 16.5s unless explicitly documented in manifest warnings.

### Acceptance Criteria

Run:

```bash
python /workspace/projects/media-pipeline/generate_video_sequence.py \
  --prompt "two original anime samurai warriors fight in a moonlit bamboo forest, readable sword choreography, close-up eyes, blade clash sparks, water and fire trails, no text, no watermark, no gore" \
  --duration-seconds 8 \
  --mode test \
  --style-preset anime_action \
  --control-mode flf2v \
  --postprocess ffmpeg_fps \
  --target-fps 16
```

Expected:

```text
status=completed
manifest exists
shot_count >= 3 for 8s action test, or explicitly documented if still 2
source shots are shorter than 4.125s
final video exists under /opt/data/hermes/generated-videos
```

## Phase 2 - Real Motion Interpolation

### Goal

Replace fake 16fps frame duplication with real interpolation so the motion feels less stuttery.

### Required Changes

1. Install or add a frame interpolation model for ComfyUI.

Current ComfyUI exposes:

```text
FrameInterpolate
FrameInterpolationModelLoader
```

But current model options are empty, so `frame_interpolate` falls back to `ffmpeg_fps`.

2. Add a reliable detection step:

```text
curl http://host.docker.internal:8188/object_info
```

Verify `FrameInterpolationModelLoader` exposes at least one valid model.

3. Update `generate_video_sequence.py` postprocess behavior:

```text
postprocess=frame_interpolate
```

Should use ComfyUI FrameInterpolate when available, otherwise warn and fall back to `ffmpeg_fps`.

4. Consider adding an external fallback script if ComfyUI interpolation is unstable:

```text
postprocess=rife_cli
```

Only add this if a local RIFE/FILM CLI can be installed cleanly without breaking the existing containers.

### Acceptance Criteria

Run a 4-8s test and compare unique frame count:

```bash
ffmpeg -v info -i output.mp4 -vf mpdecimate -an -f null - 2>&1 | tail -40
```

Expected:

```text
frame count after mpdecimate should be much closer to total frame count than before.
```

For a 16fps 8s output:

```text
total frames: about 128
unique frames should not collapse to about 64
```

## Phase 3 - Better Anime Keyframes

### Goal

Improve the image quality and pose accuracy before Wan2.1 animation. Stronger input frames will improve video more than prompt length alone.

### Required Changes

1. Audit current keyframe generator.

Current workflow uses Flux keyframes. It creates acceptable generic images but is not specialized for Japanese 2D anime action.

2. Add an anime-specific keyframe workflow if available in ComfyUI.

Options to evaluate:

```text
SDXL anime checkpoint
Pony/Illustrious/anime-style checkpoint
Flux anime LoRA if available
ControlNet/OpenPose/Canny for pose control
IPAdapter/character reference if available
```

Do not install large models blindly. First inspect available model folders in ComfyUI and document exact missing assets.

3. Add `keyframe_style` parameter:

```text
keyframe_style=flux_default
keyframe_style=anime_checkpoint
keyframe_style=anime_controlnet_pose
```

4. For anime action, generate stronger start/end keyframes:

```text
- strong silhouette
- clear two-character spacing
- visible katana geometry
- readable hands and face
- impact pose
- speed-line composition
- elemental trail placement
```

5. Add optional keyframe-only preview mode for Hermes:

```text
generate_video_sequence(..., keyframe_preview=true)
```

This should generate and send contact sheet of keyframes before spending 30+ minutes on video.

### Acceptance Criteria

For each planned shot, produce start/end keyframes and a contact sheet:

```text
/opt/data/hermes/generated-images/<sequence>_keyframe_contact.jpg
```

The contact sheet must show:

```text
- recognizable characters
- readable katana pose
- no severe anatomy failure
- no text/watermark
- action progression from shot to shot
```

## Phase 4 - Anime Edit Pass

### Goal

Make the stitched video feel more like edited anime action, not raw generated clips.

### Required Changes

Add a postprocess script:

```text
/workspace/projects/media-pipeline/postprocess_anime_action.py
```

Features:

1. Impact flash on blade clash shots.
2. Subtle camera shake on impact frames.
3. Speed ramp around clash/counter shots.
4. Optional slash trail overlay using simple generated alpha shapes or ffmpeg filters.
5. Sharpen/contrast/color pass tuned for anime:

```text
unsharp
curves or eq contrast/saturation
optional vignette
```

6. Optional music/sfx later, but do not include in the first implementation unless user asks.

Recommended tool parameter:

```text
edit_preset=none|anime_action_basic|anime_action_strong
```

Default after validation:

```text
edit_preset=anime_action_basic
```

### Acceptance Criteria

Generate a before/after pair:

```text
raw_sequence.mp4
raw_sequence-anime-edit.mp4
```

The edited version should have visibly stronger impact and contrast without destroying details.

## Phase 5 - Hermes Tool Schema Update

### Goal

Expose the new controls safely to Hermes while keeping Telegram prompt simple.

### Required Changes

Update `/workspace/hermes-agent/plugins/local_media/tools.py` schema for `generate_video_sequence`:

```text
shot_count
shot_duration_seconds
frames_per_shot
wan_steps_per_shot
motion_profile
keyframe_style
keyframe_preview
edit_preset
postprocess=frame_interpolate
```

Recommended defaults for GenVideo profile after implementation:

```text
style_preset=anime_action
control_mode=flf2v
postprocess=frame_interpolate if available, else ffmpeg_fps
edit_preset=anime_action_basic
motion_profile=fast_readable_action
keyframe_preview=false by default
```

Also update the skill:

```text
/opt/data/hermes/skills/creative/local-comfy-wan-video/SKILL.md
```

The skill should instruct Hermes:

```text
For anime action, prefer generate_video_sequence.
Use many short shots instead of one long shot.
If the user asks for high quality, use quality mode, FLF2V, anime_action style, real interpolation if available, and anime_action_basic edit pass.
Always send final video with MEDIA:/opt/data/hermes/generated-videos/<file>.mp4.
```

## Phase 6 - Testing Matrix

### Test 1 - Plumbing Fast

Telegram prompt:

```text
Dùng tool generate_video_sequence chạy anime action plumbing test.
Prompt: "two original anime samurai warriors clash under moonlit bamboo, clean cel-shaded line art, readable katana poses, sparks, no text, no watermark, no gore"
Thông số:
- duration_seconds=8
- mode=test
- style_preset=anime_action
- control_mode=flf2v
- postprocess=ffmpeg_fps
- target_fps=16
- edit_preset=none
Sau khi xong gửi video bằng MEDIA path.
```

Pass criteria:

```text
Completes under 10 minutes
Video delivered to Telegram
No workflow errors
Manifest records all settings
```

### Test 2 - Keyframe Preview

Telegram prompt:

```text
Dùng tool generate_video_sequence tạo keyframe preview cho anime action.
Prompt: "two original anime samurai warriors fight in a moonlit bamboo forest, close-up eyes, katana clash, dodge counter slash, water and fire trails, clean cel-shaded Japanese anime style, no text, no watermark, no gore"
Thông số:
- duration_seconds=12
- mode=quality
- style_preset=anime_action
- keyframe_preview=true
- keyframe_style=anime_checkpoint nếu có, nếu không dùng flux_default
Gửi contact sheet keyframe bằng MEDIA path.
```

Pass criteria:

```text
Contact sheet shows readable shot progression before expensive video render.
```

### Test 3 - Quality Short

Telegram prompt:

```text
Dùng tool generate_video_sequence tạo video anime action quality ngắn.
Prompt: "two original anime samurai warriors fight in a moonlit bamboo forest, cinematic 2D Japanese anime sword battle, close-up intense eyes, hands gripping katana, diagonal blade clash with sparks, dodge counter slash, water and fire energy trails, clean cel shading, sharp silhouettes, readable choreography, dramatic lighting, no text, no watermark, no logo, no gore"
Thông số:
- duration_seconds=8
- mode=quality
- style_preset=anime_action
- control_mode=flf2v
- motion_profile=fast_readable_action
- postprocess=frame_interpolate nếu khả dụng, nếu không ffmpeg_fps
- target_fps=16 hoặc 24 nếu interpolation thật chạy ổn
- edit_preset=anime_action_basic
Sau khi xong gửi video bằng MEDIA path.
```

Pass criteria:

```text
Choreography more readable than baseline
Less duplicate-frame stutter
At least 4-5 distinct shots
Final file delivered
```

### Test 4 - Quality 12s

Run only after Test 3 passes.

Expected runtime may remain 30+ minutes on RTX 3090 depending on model and shot count.

### Test 5 - 20s Showcase

Run only after 8s/12s quality are acceptable.

Do not run 30s until 20s is stable and worth the runtime.

## Quality Review Rubric

Score each output from 1-5:

```text
1. Keyframe image quality
2. Character consistency
3. Katana/hand anatomy
4. Motion clarity
5. Choreography readability
6. Impact feeling
7. Anime style fit
8. Temporal stability
9. Editing/rhythm
10. Upload readiness
```

Upload readiness guidance:

```text
1-2: internal test only
3: okay as WIP/AI workflow demo
4: acceptable short social post with caveat
5: strong public showcase
```

Current baseline is around:

```text
3/5 for WIP demo
1.5-2/5 for serious anime audience upload
```

## Known Constraints

- RTX 3090 24GB is usable but not enough for carefree long/high-res video generation.
- Current Wan2.1 output is 832x480. Upscaling may be needed after motion quality improves.
- Prompting alone will not solve choreography. The workflow needs more structured pose/keyframe/control.
- `ffmpeg_fps` is not real interpolation.
- Long quality renders can take 30+ minutes. Always test short first.

## Suggested Implementation Order For Assigned Agent

1. Read:

```text
/workspace/HERMES_GENVIDEO_CONTEXT_HANDOFF.md
/workspace/HERMES_GENVIDEO_RUNBOOK.md
/workspace/HERMES_GENVIDEO_IMPROVEMENT_PLAN.md
```

2. Implement Phase 1 only.

3. Run py_compile:

```bash
python3 -m py_compile \
  /workspace/projects/media-pipeline/generate_video.py \
  /workspace/projects/media-pipeline/generate_video_sequence.py \
  /workspace/hermes-agent/plugins/local_media/tools.py
```

4. Run CLI plumbing test.

5. Report exact output paths, manifest path, duration/fps, and runtime.

6. Wait for review before Phase 2/3.

## Do Not Do

- Do not touch `ai-sandbox`.
- Do not delete Docker volumes.
- Do not run `docker system prune`.
- Do not install huge models without reporting required disk/VRAM first.
- Do not copy copyrighted anime characters or exact scene identity.
- Do not judge quality from smoke/test mode.
