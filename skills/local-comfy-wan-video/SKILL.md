---
name: local-comfy-wan-video
description: Operate the local Hermes GenVideo workflow using the correct local video engine: LTX-2.3 for realistic/social/product clips and Wan2.1 for anime action.
---

Route requests by content type first. Do not default everything to Wan2.1.

## Default routing

- For realistic, cinematic, travel, camping, lifestyle, product, marketing, and social-media clips:
  - use `generate_ltx_video` for a single short shot
  - use `generate_ltx_video_sequence` for longer or multi-shot clips
- For anime action or when the user explicitly asks for Wan2.1:
  - use `generate_video` or `generate_video_sequence`

## Social preview rule

If the user wants a video for Facebook/social preview, do not use a smoke/test clip as the final preview artifact.

- `generate_video` with `mode=test` produces an extremely short smoke clip and may look blank or unusable.
- `generate_ltx_video` with `mode=standard` is the safe default for a user-reviewable short realistic clip.
- Only use `mode=test` when the user explicitly asks for a plumbing/smoke test.

## Realistic / social clip defaults

For ordinary social/travel/camping requests, prefer:

```json
{
  "prompt": "DETAILED_ENGLISH_PROMPT",
  "mode": "standard",
  "style": "travel"
}
```

Use `style="social_ad"` or `style="product"` when more appropriate.

When the user asks for a longer social clip, use `generate_ltx_video_sequence`.

## Anime action defaults

Use the `generate_video_sequence` tool for anime action multi-shot requests.

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

## Delivery rule

When a video tool succeeds, send the returned `media` or `send_to_user` value verbatim.

Example:

```text
MEDIA:/opt/data/hermes/generated-videos/example.mp4
```

Do not summarize the path loosely and do not leave the MEDIA path blank.

See references:

- `references/quality-workflow.md`
- `references/troubleshooting.md`
- `references/operations.md`
