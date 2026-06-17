# Hermes Project Documents Index

This file is a handoff index for a new agent taking over the Hermes multi-agent + local media/video tooling work.

## Core Package Docs

- `README.md`  
  Main package overview for `hermes-agent-plugin`. Start here to understand what this repository packages for a fresh environment.

- `docs/AGENT_BOOTSTRAP_PROMPT.md`  
  Bootstrap instructions for a new agent installing or operating this package.

- `docs/INSTALL_FOR_NEW_AGENT.md`  
  Install/run instructions for bringing the plugin and pipeline into another Hermes environment.

- `docs/PACKAGE_CONTENTS.md`  
  Inventory of packaged files and what should be included when moving the plugin to a new machine.

- `docs/REQUIRED_MODELS.md`  
  Model inventory and placement notes for ComfyUI/Wan/Animagine/RIFE/LTX related assets.

- `docs/OPERATIONS.md`  
  Operational commands and common maintenance tasks.

- `docs/TROUBLESHOOTING.md`  
  Known failure modes and fixes for Hermes gateway, ComfyUI, model paths, media delivery, and related runtime issues.

## Hermes Profiles / Multi-Agent Docs

- `docs/HERMES_PROFILE_CONFIG.md`  
  High-level profile configuration notes.

- `docs/HERMES_BOT_PROFILE_CREATION_RUNBOOK.md`  
  Step-by-step guide for creating new Telegram-backed Hermes profiles/bots.

- `docs/HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md`  
  Operations handbook for HerVid, HerResearch, HerDev, HerTran, and other profiles. Includes CLI health-check/restart patterns.

- `docs/HERTRAN_PROFILE.md`  
  HerTran profile notes for translation/email/chat reply support.

- `docs/HERTRAN_STYLE_GUIDE.md`  
  Japanese business communication style guide derived from Nero's preferred PM/customer communication tone.

- `docs/HERTRAN_SOUL.md`  
  Concise persona/behavior layer for HerTran.

## GenVideo / HerVid Docs

- `docs/HERMES_GENVIDEO_RUNBOOK.md`  
  Main operational runbook for HerVid + ComfyUI + Wan2.1. Use this to recover the historical context of setup, model locations, common errors, and successful commands.

- `docs/HERMES_GENVIDEO_IMPROVEMENT_PLAN.md`  
  Historical improvement plan for raising anime action video quality through phases: shot planning, FLF2V, RIFE interpolation, Animagine keyframes, single-scene keyframe validation, etc.

- `docs/QUALITY_WORKFLOW.md`  
  Quality workflow notes for evaluating generated videos and deciding when to improve prompts/pipelines/models.

- `docs/HERVID_LTX_2_3_VIDEO_PIPELINE_PLAN.md`  
  Strategic plan for adding LTX-2.3 Image-to-Video as a separate HerVid path for realistic/product/travel/social clips.

- `docs/HERVID_LTX_2_3_CONTROLLER_SPEC.md`  
  Controller spec produced for the LTX-2.3 tool contract. Treat it as planning/spec artifact.

- `docs/HERVID_LTX_2_3_IMPLEMENTATION_PLAN.md`  
  Implementation plan for LTX-2.3 Phase 1. The current work-in-progress follows this plan.

## Research / Web Automation Docs

- `docs/OARAI_CAMP_AVAILABILITY_TOOL.md`  
  Documentation for the Oarai Camp availability CLI tool. Important mapping: `休日` must be treated as `closed_or_non_bookable`, not simply “holiday/open”.

- `configs/playwright-mcp.herresearch.json`  
  Playwright MCP config for HerResearch. Useful when troubleshooting browser automation.

## Source Areas

- `hermes-plugin/local_media/tools.py`  
  Hermes local media tool definitions/handlers. Current WIP adds `generate_ltx_video`.

- `media-pipeline/generate_video.py`  
  Existing single-shot Wan2.1/Flux/Animagine pipeline.

- `media-pipeline/generate_video_sequence.py`  
  Existing multi-shot Wan2.1 sequence pipeline.

- `media-pipeline/generate_ltx_video.py`  
  New WIP LTX-2.3 single-shot pipeline. Validate and finish this before adding multi-shot LTX.

- `media-pipeline/workflows/ltx_2_3_i2v_api.json`  
  New WIP native local ComfyUI API workflow for LTX-2.3. It uses local model nodes, not the Comfy cloud/API node.

- `bin/oarai-camp-availability`, `src/oaraiCampAvailability.js`, `test/oarai-camp-availability.test.js`  
  Oarai Camp availability tool source/test files.

## Current WIP As Of 2026-06-17

Git status before handoff showed these uncommitted changes:

```text
 M hermes-plugin/local_media/tools.py
?? media-pipeline/generate_ltx_video.py
?? media-pipeline/workflows/ltx_2_3_i2v_api.json
```

The WIP adds an explicit `generate_ltx_video` Hermes tool and a native local LTX-2.3 ComfyUI workflow. Static validation passed:

```bash
python3 -m py_compile   /workspace/hermes-agent-plugin/media-pipeline/generate_ltx_video.py   /workspace/hermes-agent-plugin/hermes-plugin/local_media/tools.py   /workspace/projects/media-pipeline/generate_ltx_video.py   /workspace/hermes-agent/plugins/local_media/tools.py

python3 /workspace/projects/media-pipeline/generate_ltx_video.py   --prompt 'a cinematic close-up of a white ceramic coffee cup on a wooden table, morning sunlight, gentle steam rising, slow push-in camera, no text, no watermark'   --mode test   --validate-only
```

`--validate-only` returned `status=validated` with the expected LTX model names. A short render smoke test was attempted after that, but no new LTX output video was confirmed before this handoff. The next agent should validate/render again and inspect ComfyUI logs if it fails.

## Recommended Reading Order For New Agent

1. `README.md`
2. `docs/HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md`
3. `docs/HERMES_GENVIDEO_RUNBOOK.md`
4. `docs/HERVID_LTX_2_3_IMPLEMENTATION_PLAN.md`
5. `docs/HERVID_LTX_2_3_CONTROLLER_SPEC.md`
6. `hermes-plugin/local_media/tools.py`
7. `media-pipeline/generate_ltx_video.py`
8. `media-pipeline/workflows/ltx_2_3_i2v_api.json`
