# Quality Workflow

## Current Rule

For anime action, use a keyframe-first workflow:

1. Generate start/end keyframes only.
2. Review contact sheet visually.
3. If keyframes pass, render Wan FLF2V from those approved keyframes.
4. Interpolate to 16fps with RIFE if available.
5. Send exact `MEDIA:` path.

Do not tune Wan output before keyframes are clean. Bad keyframes create bad video.

## Recommended Anime Action Parameters

```text
duration_seconds=8
mode=quality
style_preset=anime_action
storyboard_mode=action_core
control_mode=flf2v
keyframe_engine=animagine
keyframe_frame_mode=single_scene
keyframe_quality_preset=anime_action_v2
shot_prompt_strength=strong
composition_profile=auto
motion_profile=impact
postprocess=frame_interpolate
target_fps=16
```

## Keyframe Acceptance Criteria

Reject keyframes with manga/comic panel collage, split screen, black separator bands, unreadable sword position, malformed hands/faces, character identity swapping, or abstract streaks replacing characters.

Accept keyframes that look like single-scene anime film stills with clear characters, readable pose, and foreground/background separation.

## Known Limitation

The pipeline can improve anime style and shot planning, but Wan2.1 may still struggle with complex close-range sword choreography. Future work may add pose/control workflows, stronger character consistency control, and postproduction overlays/compositing.
