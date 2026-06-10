# Install For New Agent

This procedure rebuilds the GenVideo workflow on a new Hermes environment that already has equivalent base services.

## 1. Clone Or Copy The Repo

Place this repo somewhere readable inside the Hermes container, for example:

```text
/workspace/hermes-agent-plugin
```

## 2. Install Plugin And Pipeline

From the repo root:

```bash
bash scripts/install_into_hermes.sh
```

This copies:

```text
hermes-plugin/local_media -> /workspace/hermes-agent/plugins/local_media
media-pipeline            -> /workspace/projects/media-pipeline
skills/local-comfy-wan-video -> /opt/data/hermes/skills/creative/local-comfy-wan-video
```

It also creates output directories, applies the Hermes gateway MEDIA delivery patch, and runs Python syntax checks.

## 3. Check Required Services And Models

```bash
bash scripts/verify_genvideo_env.sh
```

Do not continue to full video rendering until the script reports the required services and model names.

## 4. Configure Hermes Profile

Review `docs/HERMES_PROFILE_CONFIG.md` and ensure the GenVideo profile enables only the required toolsets:

- `clarify`
- `messaging`
- `local_media`

Keep memory disabled for the GenVideo profile unless deliberately needed.

## 5. Restart Gateway

```bash
bash scripts/restart_hermes_gateway.sh
```

## 6. Keyframe-Only Acceptance

```bash
bash scripts/smoke_test_keyframes.sh
```

Review the contact sheet path printed by the script. Do not render Wan video if keyframes show manga panels, split-screen collage, black internal bands, deformed hands/faces, unreadable swords, or inconsistent characters.

## 7. Short Video Smoke Test

After keyframes pass visual review:

```bash
bash scripts/smoke_test_video.sh
```

Expected output:

- `status=completed`
- MP4 under `/opt/data/hermes/generated-videos`
- manifest under `/opt/data/hermes/media-sequences`
- `effective_postprocess_mode=frame_interpolate` if RIFE is available, otherwise `ffmpeg_fps`

## 8. Telegram Test Prompt

Send Hermes:

```text
Dùng tool generate_video_sequence tạo video anime action ngắn.
Prompt: two original anime samurai warriors clash blades in a moonlit bamboo forest, cinematic Japanese 2D anime sword battle, close-up intense eyes, hands gripping katana, diagonal blade clash with sparks, one warrior dodges and counters with a low-angle slash, water and fire energy trails around the blades, clean cel-shaded line art, sharp silhouettes, readable choreography, dramatic lighting, no text, no watermark, no logo, no gore
Thông số: duration_seconds=8, mode=quality, style_preset=anime_action, storyboard_mode=action_core, control_mode=flf2v, keyframe_engine=animagine, keyframe_frame_mode=single_scene, keyframe_quality_preset=anime_action_v2, shot_prompt_strength=strong, composition_profile=auto, motion_profile=impact, postprocess=frame_interpolate, target_fps=16.
Sau khi xong gửi video bằng đúng MEDIA path từ tool result, không sửa tên file.
```
