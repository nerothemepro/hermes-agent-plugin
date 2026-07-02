# Hermes LM Studio Preload Strategy

This document defines the practical auto-load strategy for LM Studio models used by the Hermes multi-profile setup.

## Goal

Reduce manual LM Studio work after reboot:

- Hermes profile gateways already auto-start inside `hermes-sandbox`.
- LM Studio models should also come up in a predictable state.
- The setup must avoid wasting VRAM or breaking HerVid video renders.

## Current Constraint

Hermes gateway auto-start is already handled by:

- [HERMES_AUTOSTART.md](/workspace/hermes-agent-plugin/docs/HERMES_AUTOSTART.md:1)
- [herprofiles_boot.sh](/workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh:1)

That only starts Hermes profile processes. It does not load LM Studio models.

## Important LM Studio Rule

Hermes profile config may say `context_length: 65536`, but the real limit is the context loaded in LM Studio. If LM Studio loads a model with a smaller real context, Hermes can still fail with `Context length exceeded`.

Reference:

- [HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md](/workspace/hermes-agent-plugin/docs/HERMES_MULTI_PROFILE_OPERATIONS_HANDBOOK.md:47)

Recommended minimums currently documented:

- `hervid` / `google/gemma-4-12b-qat`: `16384`
- `herresearch` / `google/gemma-4-26b-a4b-qat`: `32768`
- `herdev` / `qwen/qwen3.6-27b`: `32768`
- `hertran` / `google/gemma-4-26b-a4b-qat`: `65536`

## Do Not Preload Everything

On this machine, HerVid's LTX path explicitly unloads resident LM Studio models before rendering because the single RTX 3090 24GB cannot hold both the LLM and the LTX-2.3 22B render at the same time.

Reference:

- [generate_ltx_video.py](/workspace/hermes-agent-plugin/media-pipeline/generate_ltx_video.py:350)

Implication:

- A naive "load every model at boot" policy is not optimal.
- For HerVid LTX renders, resident LLMs are a liability, not a benefit.

## Recommended Auto-Load Design

Use a tiered strategy instead of preloading every model for every bot.

### Tier 1: Always-on shared text model

Preload one shared instance of:

- `google/gemma-4-26b-a4b-qat`

Use it for:

- `herresearch`
- `herwiki`
- `hersocial`
- `hertran` only if the same loaded context is sufficient

Recommended baseline:

- Start with `32768` context for the shared 26B model
- Move to `65536` only if your current host setup has already proven stable with HerTran

Reason:

- These profiles are mostly text-first and benefit from having one warm shared model.
- Sharing one loaded model is cheaper than preloading multiple different text models.

### Tier 2: On-demand dev model

Do not preload by default:

- `qwen/qwen3.6-27b`

Use it for:

- `herdev`

Reason:

- It is only needed during coding sessions.
- Keeping it unloaded reduces idle VRAM pressure and avoids contention with the shared 26B model.

### Tier 3: HerVid startup preload with render-time unload

Preload at stack startup:

- `google/gemma-4-12b-qat`

Use it for:

- `hervid`

Reason:

- If HerVid reaches LM Studio before this model is explicitly warmed, LM Studio can auto-load it with an undersized real context.
- That has already produced `Context length exceeded` failures even though the Hermes profile declares a larger context.
- The video pipeline still unloads resident LM Studio models before heavy LTX renders, so startup preload and render-time VRAM safety are compatible.

## Best Practical Host Workflow

After Windows login:

1. Start LM Studio server.
2. Preload the shared 26B model.
3. Preload `google/gemma-4-12b-qat` for HerVid before Telegram traffic arrives.
4. Preload `qwen/qwen3.6-27b` for HerDev before coding/SDTK requests arrive.
5. Let `herprofiles_boot.sh` or `herprofiles_recover.sh` bring Hermes gateways online.

## What To Automate

### Safe automation to add now

- Host startup task: start LM Studio.
- Host startup task: warm the shared `google/gemma-4-26b-a4b-qat` model with the chosen context.
- Host startup task: warm `google/gemma-4-12b-qat` so HerVid does not rely on LM Studio auto-load defaults.
- Host startup task: warm `qwen/qwen3.6-27b` so HerDev is ready for coding/SDTK work immediately after reboot.
- Container startup: continue using the existing Hermes gateway boot script.

### Automation to watch carefully

- Preloading all three primary models on every reboot is now intentional for this operator setup, but it increases idle VRAM/RAM pressure.
- Loading multiple instances of the same 26B model with different contexts should still be avoided unless you have verified the memory cost and queueing behavior.

Note: preloading HerVid and HerDev at startup is now intentional, but the render pipeline may still unload resident LM Studio models during heavy LTX work to free VRAM.

## Recommended Standardization

If you want the simplest stable setup, standardize like this:

- Shared always-on model:
  - `google/gemma-4-26b-a4b-qat`
  - context: `32768` or your proven stable `65536`
- Startup-preloaded models:
  - `google/gemma-4-12b-qat`
  - `qwen/qwen3.6-27b`
- On-demand models:
  - none by default; use `-SkipHerDevWarmup` or `-SkipHerVidWarmup` when intentionally reducing startup memory pressure

This gives:

- HerResearch, HerWiki, and HerSocial ready immediately after reboot
- HerTran ready too if the chosen shared 26B context is sufficient
- HerVid protected from undersized first-load context failures
- HerDev ready immediately for coding/SDTK work after reboot

## Verification

Check that Hermes sees the right model ids:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_verify.sh hervid"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_verify.sh herresearch"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_verify.sh herdev"
```

Check current profile logs for context mismatch:

```powershell
docker exec -it hermes-sandbox bash -lc "grep -E 'Context length exceeded|n_ctx|n_keep|API call failed|ERROR' /opt/data/hermes-profiles/hervid/logs/gateway.log | tail -80"
docker exec -it hermes-sandbox bash -lc "grep -E 'Context length exceeded|n_ctx|n_keep|API call failed|ERROR' /opt/data/hermes-profiles/herresearch/logs/gateway.log | tail -80"
```

## Next Implementation Step

The missing piece is a host-side preload script for LM Studio. It should run outside Docker because LM Studio is a Windows-side service, not a process inside `hermes-sandbox`.

Before creating that script, verify on the host:

```powershell
lms --help
```

If the LM Studio CLI is available, create a Windows startup task that:

1. starts LM Studio server
2. loads the shared 26B model with the chosen context
3. optionally loads HerVid or HerDev models on demand through separate helper scripts

