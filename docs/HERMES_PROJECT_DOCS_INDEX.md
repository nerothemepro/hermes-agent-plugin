# Hermes Project Documents Index

This file is a handoff index for a new agent taking over the Hermes multi-agent + local media/video tooling work.

- `docs/BACKLOG.md`  
  Active phased backlog for the full Hermes multi-bot stack, including HerOrches governance, portability packaging, and operator expansion.

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

- `docs/HERWIKI_PROFILE.md`  
  HerWiki profile notes for maintaining Nero's markdown-first personal wiki at `/workspace/sdtk-wiki/ai-agent-second-brain-main`.

- `docs/HERWIKI_SOUL.md`  
  Runtime persona/behavior layer for HerWiki. It requires re-reading the wiki `CLAUDE.md` contract after fresh sessions and `/new` or `/reset`.

- `docs/HERORCHES_PROFILE.md`  
  HerOrches profile notes for fleet monitoring, operator commands, and recovery boundaries.

- `docs/HERORCHES_SOUL.md`  
  Runtime persona/behavior layer for the operator bot. It now explicitly reloads the system handoff/runbook after fresh sessions and `/new` or `/reset`.

- `docs/HERORCHES_MONITORING_RUNBOOK.md`  
  Runbook for HerOrches health collection, bounded recovery, and host-watchdog operations.

- `docs/HERORCHES_SYSTEM_HANDOFF.md`  
  Consolidated operator/diagnostic handoff for the full HerBot stack. Start here when HerOrches or a new operator needs one compact view of profile ownership, dependencies, workflows, and failure patterns.

- `docs/HERORCHES_PHASE_ROADMAP.md`  
  Approved multi-phase roadmap for stabilizing and expanding HerOrches.

- `docs/HERORCHES_PHASE1_IMPLEMENTATION_PLAN.md`  
  Bounded implementation plan for Phase 1 host watchdog automation.

- `docs/HERORCHES_PHASE2_IMPLEMENTATION_PLAN.md`  
  Bounded implementation plan for Phase 2 `hermes-agent` fork governance and shortcut patch control.

- `docs/HERMES_AGENT_FORK_GOVERNANCE_RUNBOOK.md`  
  Runbook for the governed `hermes-agent` fork, including scope boundaries, branch strategy, and upstream sync workflow.

- `docs/HERSTACK_PHASE2_5_PORTABILITY_IMPLEMENTATION_PLAN.md`  
  Bounded implementation plan for full-stack portability packaging and operator rebuild documentation.

## Additional Runtime Profile Docs

- `docs/HERVID_PROFILE.md`  
  Runtime profile documentation for HerVid, including its persistent bootstrap contract and video-tool routing rules.

- `docs/HERVID_SOUL.md`  
  Runtime persona/bootstrap layer for HerVid. It explicitly reloads GenVideo runbooks after fresh sessions and `/new` or `/reset`.

- `docs/HERSOCIAL_PROFILE.md`  
  Runtime profile documentation for HerSocial, including its persistent bootstrap contract and Graph API publish boundary.

- `docs/HERSOCIAL_SOUL.md`  
  Runtime persona/bootstrap layer for HerSocial. It explicitly reloads social workflow docs after fresh sessions and `/new` or `/reset`.

- `docs/HERRESEARCH_PROFILE.md`  
  Runtime profile documentation for HerResearch, including its persistent bootstrap contract and deterministic-research helper boundaries.

- `docs/HERRESEARCH_SOUL.md`  
  Runtime persona/bootstrap layer for HerResearch. It explicitly reloads research/browser/helper docs after fresh sessions and `/new` or `/reset`.

- `docs/HERDEV_PROFILE.md`  
  Runtime profile documentation for HerDev, including its persistent bootstrap contract for SDTK-governed repo work.

- `docs/HERDEV_SOUL.md`  
  Runtime persona/bootstrap layer for HerDev. It explicitly reloads AGENTS/bootstrap working rules after fresh sessions and `/new` or `/reset`.

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

- `docs/FACEBOOK_CAPTURE_TO_WIKI_INBOX_TOOL.md`  
  Documentation for the HerResearch-to-HerWiki Facebook capture helper. It writes standardized raw markdown captures into the wiki `raw/inbox/` for later HerWiki ingest.

- `docs/FACEBOOK_BATCH_CAPTURE_TO_WIKI_INBOX_TOOL.md`  
  Documentation for the deterministic batch Facebook capture helper. Use this when HerResearch processes multiple Facebook links and must report exact `raw_path` values while skipping login-wall or blocked links.

- `docs/HERWIKI_INGEST_LATEST_RAW_INBOX_TOOL.md`  
  Documentation for the HerWiki helper that resolves the newest markdown file in `raw/inbox/` and emits a ready-to-use ingest prompt.

- `configs/playwright-mcp.herresearch.json`  
  Playwright MCP config for HerResearch. Useful when troubleshooting browser automation.

## Source Areas

- `hermes-plugin/local_media/tools.py`  
  Hermes local media tool definitions/handlers, including `generate_ltx_video` for LTX-2.3 single-shot renders.

- `media-pipeline/generate_video.py`  
  Existing single-shot Wan2.1/Flux/Animagine pipeline.

- `media-pipeline/generate_video_sequence.py`  
  Existing multi-shot Wan2.1 sequence pipeline.

- `media-pipeline/generate_ltx_video.py`  
  LTX-2.3 single-shot pipeline. Phase 1 smoke render has passed; review before adding multi-shot LTX.

- `media-pipeline/workflows/ltx_2_3_i2v_api.json`  
  Native local ComfyUI API workflow for LTX-2.3. It uses local model nodes, not the Comfy cloud/API node.

- `bin/oarai-camp-availability`, `src/oaraiCampAvailability.js`, `test/oarai-camp-availability.test.js`  
  Oarai Camp availability tool source/test files.

## Current LTX State As Of 2026-06-17

Latest LTX implementation was committed and pushed as `ad54a57 Implement HerVid LTX 2.3 single-shot tool`. Expected git status is clean (`main...origin/main`). The implementation adds an explicit `generate_ltx_video` Hermes tool and a native local LTX-2.3 ComfyUI workflow. Static validation passed:

```bash
python3 -m py_compile   /workspace/hermes-agent-plugin/media-pipeline/generate_ltx_video.py   /workspace/hermes-agent-plugin/hermes-plugin/local_media/tools.py   /workspace/projects/media-pipeline/generate_ltx_video.py   /workspace/hermes-agent/plugins/local_media/tools.py

python3 /workspace/projects/media-pipeline/generate_ltx_video.py   --prompt 'a cinematic close-up of a white ceramic coffee cup on a wooden table, morning sunlight, gentle steam rising, slow push-in camera, no text, no watermark'   --mode test   --validate-only
```

`--validate-only` returned `status=validated` with the expected LTX model names. A native LTX smoke render also passed at `512x320`, `1s`, `8fps`, `1 step`, outputting `/opt/data/hermes/generated-videos/two-original-anime-samurai-warriors-hold-a-dramatic-1781684597-a0d320f5.mp4`. Higher `768x512` settings OOMed in the current runtime, so defaults are intentionally conservative.

## Recommended Reading Order For New Agent

1. `README.md`
2. `docs/HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md`
3. `docs/HERMES_GENVIDEO_RUNBOOK.md`
4. `docs/HERVID_LTX_2_3_IMPLEMENTATION_PLAN.md`
5. `docs/HERVID_LTX_2_3_CONTROLLER_SPEC.md`
6. `hermes-plugin/local_media/tools.py`
7. `media-pipeline/generate_ltx_video.py`
8. `media-pipeline/workflows/ltx_2_3_i2v_api.json`
