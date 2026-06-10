---
name: local-comfy-wan-video
description: Operate the local Hermes GenVideo workflow using ComfyUI keyframes and Wan2.1 video rendering.
---

Use the `generate_video_sequence` tool for multi-shot video requests.

Default anime action settings:

- `duration_seconds=8` for tests; ask before 15-30s renders.
- `mode=quality` for real user videos.
- `style_preset=anime_action`.
- `storyboard_mode=action_core` for short sword-fight scenes.
- `control_mode=flf2v`.
- `keyframe_engine=animagine`.
- `keyframe_frame_mode=single_scene`.
- `keyframe_quality_preset=anime_action_v2`.
- `shot_prompt_strength=strong`.
- `motion_profile=impact`.
- `postprocess=frame_interpolate`, `target_fps=16`.

Workflow rule:

1. For new anime action prompts, run keyframe-only first if the user asks for quality or if previous keyframes were unstable.
2. Ask the user to review the contact sheet.
3. If approved, render video using `existing_keyframe_dir` so the approved keyframes are reused exactly.
4. Send the final MP4 using the exact `MEDIA:/absolute/path.mp4` returned by the tool. Do not rewrite the filename.

Never use smoke images for real user videos.

See references:

- `references/quality-workflow.md`
- `references/troubleshooting.md`
- `references/operations.md`
