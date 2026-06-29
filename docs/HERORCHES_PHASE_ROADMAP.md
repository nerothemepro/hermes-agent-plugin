# HerOrches Phase Roadmap

Date: 2026-06-29
Owner: HerOrches controller track
Status: Approved roadmap, implementation pending

## Current Baseline

HerOrches is now live on Telegram and currently works with this architecture:

- Hermes profile: `herorches`
- Primary provider: `openai-codex`
- Primary model: `gpt-5.5`
- Local fallbacks:
  - `google/gemma-4-26b-a4b-qat`
  - `qwen/qwen3.6-27b`
- Deterministic health substrate:
  - `scripts/herorches_collect_health.py`
  - `scripts/herorches_safe_recover.sh`
- Host startup / recovery helpers:
  - `scripts/windows/Start-HermesStack.ps1`
  - `scripts/windows/Watch-HermesStack.ps1`

Current verified state:

- `/health-all` works through Telegram
- all 7 profiles report healthy
- LM Studio, ComfyUI, and Wan2.1 are reachable
- HerOrches can resolve `openai-codex` credentials and answer successfully

Latest verification evidence:

- health collection command:
  - `python3 /workspace/hermes-agent-plugin/scripts/herorches_collect_health.py --json --log-lines 20 --timeout-seconds 20`
- direct profile smoke:
  - `env HERMES_HOME=/opt/data/hermes-profiles/herorches /workspace/.venvs/hermes-agent/bin/hermes -z 'Reply with exactly: OK'`

## Roadmap Summary

The next work is intentionally split into small operational phases.

| Phase | Name | Goal | Why now | Exit signal |
|---|---|---|---|---|
| 1 | Host Watchdog Automation | Recover LM Studio, Docker, and Hermes gateways automatically after reboot or partial failure | Biggest current reliability gap | Host reboot + single-profile failure recover without manual shell work |
| 2 | Hermes Core Patch Governance | Make Telegram shortcut support reproducible and maintainable | Current shortcut UX depends on local core edits | Local divergence is documented, reproducible, and safely maintainable |
| 3 | HerOrches Operator Command Expansion | Turn HerOrches into a practical operator bot for diagnosis and bounded recovery | Valuable after recovery substrate is stable | Nero can diagnose and recover most incidents from Telegram |

### Phase 1 — Host Watchdog Automation

Goal:

- make the Windows host recover the Hermes stack automatically after reboot, Docker restart, LM Studio restart, or partial gateway failure
- reduce the need for manual Telegram-based recovery after the system is already degraded

Why first:

- this closes the biggest reliability gap in the current design
- an in-container bot cannot alert if the container itself is down
- host-side automation is the correct control plane for recovery of LM Studio + Docker + gateway processes

Primary deliverables:

- production-ready `Watch-HermesStack.ps1`
- Task Scheduler runbook
- optional Telegram alert wiring from host watchdog
- verification procedure for reboot / restart / partial failure scenarios
- deterministic one-shot and loop behavior with operator-readable output

Success signal:

- after host reboot, LM Studio + `hermes-sandbox` + all Her bots recover without manual intervention
- when one profile dies, watchdog restarts it automatically
- when LM Studio is unavailable, watchdog surfaces a clear operator-visible alert

### Phase 2 — Hermes Core Patch Governance

Goal:

- stabilize and manage the local Hermes core patch required for Telegram slash shortcuts such as `/health-all`
- prevent future upstream pulls from silently breaking the HerOrches Telegram UX

Why second:

- the current system works, but the shortcut behavior depends on local core edits in `/workspace/hermes-agent`
- those edits are not yet in a user-controlled remote

Primary deliverables:

- decision on repo strategy:
  - fork `hermes-agent` under a user-controlled GitHub account, or
  - keep a documented local patchset with reapply procedure
- patch inventory and rebase checklist
- verification commands for command-registry and gateway shortcut behavior

Success signal:

- HerOrches shortcut behavior is reproducible after future Hermes upstream updates
- operator knows exactly where the local divergence lives and how to maintain it

### Phase 3 — HerOrches Operator Command Expansion

Goal:

- deepen HerOrches into a practical operator bot beyond `/health-all`
- add guided operational usage for targeted diagnosis and bounded recovery

Primary focus:

- `/diag <profile>`
- `/tail <profile> [lines]`
- `/recover <profile>`
- `/recover-all`
- `/models`
- `/deps`
- `/incidents`

Why third:

- the base health path already works
- once Phase 1 and Phase 2 reduce platform fragility, expanding the operator surface becomes safer and more valuable

Success signal:

- Nero can handle most bot incidents directly from Telegram through HerOrches without dropping to manual shell commands

## Not In Scope For This Roadmap

- rebuilding the full Hermes gateway architecture
- replacing LM Studio
- migrating HerOrches to a separate infrastructure stack
- solving business-logic issues inside HerVid / HerSocial / HerWiki workflows unless they affect fleet health mechanics

## Recommended Execution Order

1. Phase 1 — Host Watchdog Automation
2. Phase 2 — Hermes Core Patch Governance
3. Phase 3 — HerOrches Operator Command Expansion

## Approval Boundary

Before implementation work starts for each phase, create a bounded implementation plan with explicit verification steps.

## Recommended Immediate Next Step

Proceed with Phase 1 only. Do not start Phase 2 or Phase 3 implementation until the host watchdog path is verified under realistic failure scenarios.
