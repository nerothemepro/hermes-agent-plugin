# HerOrches System Handoff

Date: 2026-06-30

Purpose: give `herorches` one compact, operationally useful briefing for diagnosing the full Hermes stack without re-reading scattered historical chat context.

This document does not replace the deeper runbooks. It is the top-level map HerOrches should read first, then follow the referenced source-of-truth docs and deterministic scripts.

## 1. System Summary

The current stack is a multi-profile Hermes deployment running inside one Docker container:

```text
Container: hermes-sandbox
Hermes source: /workspace/hermes-agent
Profiles root: /opt/data/hermes-profiles
Plugin/package repo: /workspace/hermes-agent-plugin
```

Main operating model:

- `hervid`: media generation
- `herresearch`: research + browser automation + capture
- `herdev`: coding and SDTK implementation work
- `hertran`: translation and PM/customer drafting
- `herwiki`: markdown knowledge-base maintenance
- `hersocial`: caption/draft/publish orchestration to Facebook
- `herorches`: health monitor + bounded recovery controller

Host-side dependencies:

- LM Studio on host: `http://host.docker.internal:1234/v1`
- ComfyUI on host: `http://host.docker.internal:8188`
- Wan2.1 API on host: `http://host.docker.internal:8010`
- Docker Desktop hosting `hermes-sandbox`

## 2. Primary Source-Of-Truth Reading Order

When HerOrches needs deeper context, read in this order:

1. [README.md](/workspace/hermes-agent-plugin/README.md)
2. [HERMES_PROJECT_DOCS_INDEX.md](/workspace/hermes-agent-plugin/docs/HERMES_PROJECT_DOCS_INDEX.md)
3. [HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md](/workspace/hermes-agent-plugin/docs/HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md)
4. [HERORCHES_PROFILE.md](/workspace/hermes-agent-plugin/docs/HERORCHES_PROFILE.md)
5. [HERORCHES_MONITORING_RUNBOOK.md](/workspace/hermes-agent-plugin/docs/HERORCHES_MONITORING_RUNBOOK.md)

Then branch by incident type:

- video / media failures:
  - [HERMES_GENVIDEO_RUNBOOK.md](/workspace/hermes-agent-plugin/docs/HERMES_GENVIDEO_RUNBOOK.md)
  - [QUALITY_WORKFLOW.md](/workspace/hermes-agent-plugin/docs/QUALITY_WORKFLOW.md)
  - [HERVID_LTX_2_3_VIDEO_PIPELINE_PLAN.md](/workspace/hermes-agent-plugin/docs/HERVID_LTX_2_3_VIDEO_PIPELINE_PLAN.md)
  - [TROUBLESHOOTING.md](/workspace/hermes-agent-plugin/docs/TROUBLESHOOTING.md)
- startup / model preload / watchdog failures:
  - [HERMES_WINDOWS_HOST_STARTUP_RUNBOOK.md](/workspace/hermes-agent-plugin/docs/HERMES_WINDOWS_HOST_STARTUP_RUNBOOK.md)
  - [HERMES_LMSTUDIO_PRELOAD_STRATEGY.md](/workspace/hermes-agent-plugin/docs/HERMES_LMSTUDIO_PRELOAD_STRATEGY.md)
  - [HERMES_AUTOSTART.md](/workspace/hermes-agent-plugin/docs/HERMES_AUTOSTART.md)
- wiki / browser / capture failures:
  - [HERWIKI_PROFILE.md](/workspace/hermes-agent-plugin/docs/HERWIKI_PROFILE.md)
  - [FACEBOOK_BATCH_CAPTURE_TO_WIKI_INBOX_TOOL.md](/workspace/hermes-agent-plugin/docs/FACEBOOK_BATCH_CAPTURE_TO_WIKI_INBOX_TOOL.md)
  - [HERWIKI_INGEST_LATEST_RAW_INBOX_TOOL.md](/workspace/hermes-agent-plugin/docs/HERWIKI_INGEST_LATEST_RAW_INBOX_TOOL.md)
- social post failures:
  - [HERSOCIAL_HERMES_BOT_PLAN.md](/workspace/social-auto-post/Fanpage_Builder-main/docs/HERSOCIAL_HERMES_BOT_PLAN.md)
  - [HERSOCIAL_TREND_TO_POST_CONTROLLER_PLAN.md](/workspace/social-auto-post/Fanpage_Builder-main/docs/architecture/HERSOCIAL_TREND_TO_POST_CONTROLLER_PLAN.md)
  - [runtime-commands.md](/workspace/social-auto-post/Fanpage_Builder-main/docs/architecture/runtime-commands.md)

## 3. Profile Matrix

| Profile | Role | Model | Key tools | Main risk surface |
| --- | --- | --- | --- | --- |
| `hervid` | Gen image/video via local media | `google/gemma-4-12b-qat` | `local_media`, `messaging`, `clarify` | LM Studio context, VRAM contention, ComfyUI/Wan/LTX, unsafe MEDIA path |
| `herresearch` | Research/browser/capture/report | `google/gemma-4-26b-a4b-qat` | `web`, `browser`, `terminal`, `memory`, `messaging` | browser login walls, provider auth, long context, tool loops |
| `herdev` | Coding / SDTK / repo work | `qwen/qwen3.6-27b` | `terminal`, `file`, `search`, `messaging` | model warmup absent, repo state, tool-call caps |
| `hertran` | Translation and PM/customer drafting | `google/gemma-4-26b-a4b-qat` | `memory`, `messaging`, `clarify` | context too small for style memory, profile misconfig |
| `herwiki` | Wiki maintenance / ingest / query | `google/gemma-4-26b-a4b-qat` | `terminal`, `file`, `search`, `messaging` | violating wiki contract, editing raw, missing ingest provenance |
| `hersocial` | Draft/preview/publish Facebook posts | `google/gemma-4-26b-a4b-qat` | `terminal`, `messaging`, project CLI | expired Facebook token, wrong command path, dry-run/live confusion |
| `herorches` | Fleet monitor + safe recovery | `openai-codex` primary; Gemma/Qwen fallback | `terminal`, `file`, `search`, `messaging`, `memory` | false diagnosis, over-broad recovery, acting outside safe boundary |

## 4. Runtime Boundaries HerOrches Must Respect

HerOrches may:

- inspect health JSON
- inspect logs and state files
- verify dependency reachability
- start/restart stopped or degraded gateways
- rerun bounded recovery scripts
- tell the operator exactly which manual action is needed

HerOrches must not automatically:

- rotate Telegram or Facebook secrets
- overwrite `.env` secrets
- wipe sessions or memory stores
- run destructive Docker or git cleanup
- silently change business prompts or role behavior

## 5. Startup And Recovery Model

There are two different layers. HerOrches must reason about both.

### Container-side gateway boot

Container start only guarantees the `hermes-sandbox` process space exists. Gateway bring-up is handled by:

- [herprofiles_boot.sh](/workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh)
- [herprofiles_recover.sh](/workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh)

Important truth:

- container boot does not load LM Studio models
- gateway boot does not guarantee external dependencies are healthy

### Host-side stack boot

Host-side boot is handled by:

- [Start-HermesStack.ps1](/workspace/hermes-agent-plugin/scripts/windows/Start-HermesStack.ps1)
- [Watch-HermesStack.ps1](/workspace/hermes-agent-plugin/scripts/windows/Watch-HermesStack.ps1)
- [Warm-HerVid.ps1](/workspace/hermes-agent-plugin/scripts/windows/Warm-HerVid.ps1)
- [Warm-HerDev.ps1](/workspace/hermes-agent-plugin/scripts/windows/Warm-HerDev.ps1)

Current policy:

- preload shared `google/gemma-4-26b-a4b-qat`
- preload `google/gemma-4-12b-qat` by default to protect HerVid from undersized first auto-load
- do not preload `qwen/qwen3.6-27b` by default

This matters because Hermes `config.yaml` context settings do not override a too-small real LM Studio load.

## 6. HerVid Architecture And Failure Model

HerVid now has two distinct video lanes:

1. Wan2.1 lane for anime/action:
   - `generate_video`
   - `generate_video_sequence`
2. LTX-2.3 lane for realistic/social/product/travel clips:
   - `generate_hervid_preview`
   - `generate_hervid_video`
   - `generate_ltx_video`
   - `generate_ltx_video_sequence`

Current routing truth:

- realistic/social/camping/product/travel: prefer LTX
- anime action: prefer Wan2.1
- long realistic clip: prefer `generate_ltx_video_sequence`
- user-facing HerVid path should use preview-first flow before expensive final render

### HerVid operational constraints

- `google/gemma-4-12b-qat` must be loaded with enough real context in LM Studio
- LTX 22B render cannot coexist cleanly with resident LLMs on 24GB VRAM, so render-time unload is expected
- Wan quality must not be judged from smoke/test mode
- keyframe-first review is mandatory for anime action quality work

### Frequent HerVid root causes

1. `Context length exceeded`
   - usually LM Studio loaded `google/gemma-4-12b-qat` with too-small real context
   - fix path: host preload + correct LM Studio preset + restart fresh session
2. video finished but Telegram got nothing
   - usually wrong or rewritten `MEDIA:` path
3. blank or tiny preview video
   - user/tool ran smoke/test mode instead of standard/quality
4. LTX OOM
   - expected if resident models were not unloaded or ComfyUI stochastic-rounding patch is missing
5. anime output ugly after many prompt tweaks
   - keyframes were weak; do not tune Wan before keyframe contact sheet passes visual review

## 7. HerSocial Architecture And Failure Model

HerSocial is an orchestrator over the `Fanpage_Builder-main` engine, not a browser-posting bot.

Current core path:

```text
Telegram request
  -> HerSocial
  -> optional research bundle / media path
  -> caption/draft generation
  -> preview step
  -> publish-text or publish-image
  -> Facebook Graph API
```

Current truths:

- Graph API is the intended publish channel
- dry-run is the default safety posture
- live publish requires explicit operator confirmation
- text and image publish paths are the stable baseline
- video publish is not yet the stable default in the documented minimal slice

Key runtime file:

- [hersocial_tool.py](/workspace/social-auto-post/Fanpage_Builder-main/scripts/hersocial_tool.py)

Typical failures:

1. `command not found`
   - wrong command name or wrong wrapper path
2. `facebook_auth_expired`
   - page token expired; needs manual token replacement in profile `.env`
3. dry-run/live confusion
   - agent used preview/dry-run wording when operator expected real publish
4. caption OK but no media post
   - wrong CLI subcommand or wrong media path

## 8. HerResearch + HerWiki Knowledge Ingest Workflow

This stack is intentionally split by responsibility.

### HerResearch owns retrieval

HerResearch handles:

- browser navigation
- source reading
- post/comment extraction
- GitHub repo link extraction
- writing normalized raw captures into wiki inbox through helper tools

Current browser baselines:

- Playwright MCP config exists at [playwright-mcp.herresearch.json](/workspace/hermes-agent-plugin/configs/playwright-mcp.herresearch.json)
- Browser Use cloud provider was later enabled for stronger browsing of dynamic sites

Operational truth:

- many Facebook links hit login walls
- HerResearch must not hallucinate inaccessible content
- blocked links should be reported as failed, not converted into fake raw captures

### HerWiki owns ingest and wiki edits

HerWiki must follow the wiki contract:

- read `/workspace/sdtk-wiki/ai-agent-second-brain-main/CLAUDE.md`
- never edit `raw/`
- write meaningful operations to `wiki/log.md`
- preserve provenance

### Helper tools

- single capture helper:
  - [FACEBOOK_CAPTURE_TO_WIKI_INBOX_TOOL.md](/workspace/hermes-agent-plugin/docs/FACEBOOK_CAPTURE_TO_WIKI_INBOX_TOOL.md)
- batch capture helper:
  - [FACEBOOK_BATCH_CAPTURE_TO_WIKI_INBOX_TOOL.md](/workspace/hermes-agent-plugin/docs/FACEBOOK_BATCH_CAPTURE_TO_WIKI_INBOX_TOOL.md)
- latest-ingest helper:
  - [HERWIKI_INGEST_LATEST_RAW_INBOX_TOOL.md](/workspace/hermes-agent-plugin/docs/HERWIKI_INGEST_LATEST_RAW_INBOX_TOOL.md)

Current preferred workflow:

1. HerResearch captures one or more Facebook/web links to `raw/inbox/`
2. HerWiki resolves the newest raw file and ingests it
3. HerWiki updates wiki pages and `wiki/log.md`
4. maintenance/lint/verification can run later as a separate cycle

## 9. HerTran And HerDev Notes

### HerTran

HerTran is specialized. It should not be used for generic research or wiki work.

Source-of-truth docs:

- [HERTRAN_PROFILE.md](/workspace/hermes-agent-plugin/docs/HERTRAN_PROFILE.md)
- [HERTRAN_STYLE_GUIDE.md](/workspace/hermes-agent-plugin/docs/HERTRAN_STYLE_GUIDE.md)
- [HERTRAN_SOUL.md](/workspace/hermes-agent-plugin/docs/HERTRAN_SOUL.md)

Critical operational truth:

- good output depends on the stored style guide and enough Gemma 26B context

### HerDev

HerDev is the SDTK/coding profile. It is intentionally not always warmed.

Operational truth:

- `qwen/qwen3.6-27b` is on-demand to reduce idle VRAM pressure
- if HerDev is slow or unavailable after reboot, model warmup may simply not have happened yet

## 10. Dependency Health Model

HerOrches should treat these as separate checks:

1. gateway process health
2. platform connectivity health
3. LM Studio reachability and visible models
4. container visibility to LM Studio
5. ComfyUI reachability
6. Wan2.1 reachability
7. Facebook token health when Hersocial is asked to publish
8. browser provider health when HerResearch is asked to browse

Do not collapse these into one status label too early. A bot can be `running` while still operationally broken.

## 11. Triage Order For Any Incident

When a user says `bot X is not working`, HerOrches should follow this order:

1. Identify the target profile and exact user-visible symptom
2. Check gateway state and PID
3. Check recent gateway log lines
4. Check dependency reachability for that profile
5. Check whether the expected model is both visible and properly loaded
6. Check whether the failure is profile-local, dependency-level, or workflow-level
7. Attempt only bounded recovery
8. If recovery is not allowed, report exact manual next step

## 12. Most Important Known Failure Patterns

### A. Bot stops replying after reboot

Likely layer:

- container/gateway recovery or host startup sequence

Check:

- `Start-HermesStack.ps1`
- `herprofiles_recover.sh`
- gateway status/logs

### B. HerVid says context exceeded

Likely layer:

- LM Studio real context, especially `google/gemma-4-12b-qat`

Check:

- startup preload policy
- LM Studio preset
- whether the model auto-loaded instead of warm-loaded

### C. HerVid outputs `completed` but user sees no usable video

Likely layer:

- wrong tool path, smoke/test mode, or bad `MEDIA:` path

Check:

- tool result JSON
- actual file existence under `/opt/data/hermes/generated-videos`
- exact `MEDIA:` tag

### D. HerSocial cannot publish

Likely layer:

- expired or missing Facebook page token

Check:

- `hersocial_tool.py facebook-health`
- profile `.env` token keys

### E. HerResearch cannot extract Facebook content

Likely layer:

- login wall or provider/browser limitation, not `missing content`

Check:

- whether the link is actually public
- whether batch capture helper reported `failed[]`

### F. HerWiki does not update after raw capture

Likely layer:

- ingest step never executed, or wrong/latest raw file selection, or wiki contract violation

Check:

- newest file in `raw/inbox/`
- helper output
- `wiki/log.md`

## 13. Deterministic Scripts HerOrches Should Prefer

Prefer these over free-form shell reasoning:

- `/workspace/hermes-agent-plugin/scripts/herorches_collect_health.py`
- `/workspace/hermes-agent-plugin/scripts/herorches_safe_recover.sh`
- `/workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh`
- `/workspace/hermes-agent-plugin/scripts/herprofile_status.sh`
- `/workspace/hermes-agent-plugin/scripts/herprofile_verify.sh`
- `/workspace/hermes-agent-plugin/scripts/windows/Start-HermesStack.ps1`
- `/workspace/hermes-agent-plugin/scripts/windows/Watch-HermesStack.ps1`

For social:

- `/workspace/social-auto-post/Fanpage_Builder-main/scripts/hersocial_tool.py`

For wiki capture/ingest:

- `/workspace/hermes-agent-plugin/bin/facebook-capture-to-wiki-inbox`
- `/workspace/hermes-agent-plugin/bin/facebook-batch-capture-to-wiki-inbox`
- `/workspace/hermes-agent-plugin/bin/herwiki-ingest-latest-raw-inbox`

## 14. Handoff Goal For HerOrches

After reading this file, HerOrches should be able to:

- tell which bot owns which job
- tell which dependency belongs to which failure class
- avoid dangerous `fixes` outside its authority
- route itself to the correct runbook and deterministic script
- produce a useful operator report instead of generic guesswork

## 15. Maintenance Rule

Whenever the stack changes materially, update this handoff together with:

- [HERMES_PROJECT_DOCS_INDEX.md](/workspace/hermes-agent-plugin/docs/HERMES_PROJECT_DOCS_INDEX.md)
- [HERMES_AGENT_TOOLS_CONTEXT_HANDOFF.md](/workspace/HERMES_AGENT_TOOLS_CONTEXT_HANDOFF.md)
