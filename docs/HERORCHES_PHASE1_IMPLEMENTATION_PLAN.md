# HerOrches Phase 1 Implementation Plan

Date: 2026-06-29
Phase: Host Watchdog Automation
Status: Draft for approval
Next skill after approval: `sdtk-code-execute`

## Scope Summary

This phase hardens the host-side recovery path for the local Hermes stack.

Target outcome:

- after Windows login or reboot, the host starts LM Studio, ensures the shared model is loaded, ensures `hermes-sandbox` is running, and recovers all Hermes gateways automatically
- when one or more Hermes profiles stop unexpectedly, a watchdog loop can detect and repair them without manual shell intervention
- the operator has a documented Task Scheduler setup and a deterministic verification checklist

This phase does not change application-level bot behavior. It changes operational recovery only.

Acceptance boundary for Phase 1:

- host startup command is deterministic and documented
- watchdog can recover at least one stopped profile without restarting healthy profiles
- watchdog handles LM Studio interruption with clear operator output
- Windows Task Scheduler procedure is documented and manually validated
- any host-side alerting remains optional unless explicitly enabled

## Existing Baseline

Already present:

- `scripts/windows/Start-HermesStack.ps1`
- `scripts/windows/HermesHostCommon.ps1`
- `scripts/windows/Watch-HermesStack.ps1`
- `scripts/herprofiles_recover.sh`
- `scripts/herorches_collect_health.py`
- `scripts/herorches_safe_recover.sh`

Current gap:

- watchdog behavior exists but is not yet fully productized, documented, or verified against realistic recovery scenarios
- alert flow is optional and unverified
- Windows Task Scheduler wiring is not yet codified as a phase-complete operational artifact

## Dependency Notes

- Depends on local `lms` CLI existing on host PATH
- Depends on Docker Desktop being installed and the container name remaining `hermes-sandbox`
- Depends on the existing `Start-HermesStack.ps1` and `Watch-HermesStack.ps1` scripts remaining the host control plane
- Depends on at least one stable host-side notification path if Telegram alerting is enabled
- Depends on LM Studio per-model defaults already being saved for the shared startup model

## Task List In Execution Order

### 1. Audit and normalize the watchdog contract

Purpose:

- confirm the exact control boundary between host watchdog and in-container HerOrches recovery scripts
- remove ambiguity in default profile resolution, alerting behavior, and auto-heal toggles

Files likely to change:

- `scripts/windows/Watch-HermesStack.ps1`
- `scripts/windows/HermesHostCommon.ps1`
- `docs/HERORCHES_MONITORING_RUNBOOK.md`

Verification:

- static review of parameter defaults and call graph
- PowerShell invocation with `-RunOnce -ShowHealth`
- verify the script does not require manual profile enumeration outside documented defaults

Rollback / containment:

- keep `Start-HermesStack.ps1` as the minimal recovery fallback if watchdog logic regresses

### 2. Add deterministic watchdog output and exit semantics

Purpose:

- ensure the host watchdog emits clear operator-readable output for healthy, degraded, and repaired states
- make one-shot execution suitable for Task Scheduler logs

Files likely to change:

- `scripts/windows/Watch-HermesStack.ps1`

Verification:

- run once in healthy state and capture clean status output
- run once with a stopped profile and confirm output indicates detection + recovery action
- verify non-zero exit on unrecoverable dependency failure

Rollback / containment:

- if the richer output becomes noisy or brittle, fall back to the minimal health JSON plus explicit shell logging

### 3. Verify auto-heal on single-profile failure

Purpose:

- prove the watchdog can recover a single stopped gateway without disturbing healthy profiles

Files likely to change:

- no code change required if the current script passes
- documentation updates in runbook if behavior is confirmed

Verification:

- stop one profile intentionally, for example `herresearch`
- run watchdog once
- confirm that only the failed profile is restarted
- confirm the other profiles stay running
- confirm `herorches_collect_health.py` returns healthy after recovery

Rollback / containment:

- if the watchdog restarts everything indiscriminately, tighten recovery scope before continuing

### 4. Verify host recovery path after LM Studio interruption

Purpose:

- prove the watchdog correctly handles the shared dependency case where LM Studio is not reachable

Files likely to change:

- `scripts/windows/Watch-HermesStack.ps1`
- `docs/HERORCHES_MONITORING_RUNBOOK.md`

Verification:

- stop LM Studio server or simulate unavailability
- run watchdog once
- confirm it attempts LM Studio startup and reports the dependency state clearly
- confirm the container can see the intended shared model after recovery

Rollback / containment:

- if automatic LM Studio startup is too brittle, document a manual restart boundary and keep the alert path only

### 5. Wire Windows Task Scheduler operational path

Purpose:

- turn the scripts into a durable boot/recovery mechanism instead of an ad hoc manual process

Files likely to change:

- `docs/HERMES_WINDOWS_HOST_STARTUP_RUNBOOK.md`
- `docs/HERORCHES_MONITORING_RUNBOOK.md`
- optional helper note in `docs/HERMES_AUTOSTART.md`

Verification:

- document exact Scheduler action arguments
- manual dry-run of the final command from a fresh PowerShell session
- confirm the scheduled invocation uses the same PATH/user context assumptions as manual startup

Rollback / containment:

- if Scheduler integration is flaky, retain a manual desktop shortcut / startup script fallback and document it explicitly

### 6. Optional Telegram alert validation from host watchdog

Purpose:

- validate that a host-side incident can notify Nero even if in-container bots are degraded

Files likely to change:

- `scripts/windows/Watch-HermesStack.ps1`
- `docs/HERORCHES_MONITORING_RUNBOOK.md`

Verification:

- configure `-NotifyBotToken` and `-NotifyChatId`
- simulate a known incident
- confirm alert message is delivered once, not spammed repeatedly

Rollback / containment:

- if host-side Telegram alerting is noisy or unreliable, keep the logic disabled by default and treat it as optional

## Architecture Review Notes

### Data flow boundaries

- Host layer owns:
  - LM Studio process recovery
  - Docker container start
  - watchdog scheduling
  - optional out-of-band Telegram alerting
- Container layer owns:
  - per-profile gateway status
  - deterministic health JSON
  - bounded profile restarts
- Telegram bot layer owns:
  - human-facing summaries after the system is healthy enough to answer

### State transitions

Important lifecycle states:

- host booted, LM Studio down
- LM Studio up, container down
- container up, one or more gateways down
- all profiles healthy
- degraded but recoverable
- degraded and not safely recoverable

### Dependency graph risks

- host watchdog currently depends on the `lms` CLI being callable
- profile recovery assumes stable profile names and `HERMES_HOME` layout
- alerting from host requires secret handling discipline for the bot token and chat id

### Performance / operational hotspots

- repeated model loads can waste startup time if the watchdog loop is too aggressive
- repeated Telegram alerts can create operator fatigue if incident deduplication is weak
- running expensive checks too often on a healthy system is unnecessary

### Observability coverage

Minimum operator signals needed:

- host watchdog console output
- Task Scheduler history
- HerOrches `/health-all`
- profile `gateway.log`
- `gateway_state.json`
- LM Studio loaded-model visibility from both host and container

## Happy / Missing / Empty / Error Path Review

### Happy path

- host watchdog starts cleanly
- LM Studio already available or starts successfully
- container is available
- all profiles are healthy
- watchdog emits a short healthy summary

### Missing-input path

- notification token or chat id not configured
- watchdog should still run recovery and skip alerting cleanly

### Empty / no-op path

- everything is already healthy
- watchdog should not restart healthy profiles or spam logs

### Error path

- LM Studio unavailable
- Docker unavailable
- profile recovery script fails
- watchdog should surface which dependency failed and stop short of destructive action
- shared model visible on host but not visible from container API path

## Observable State Notes

### Task 1-4 — recovery logic

Customer sees:

- usually nothing unless a bot becomes responsive again or HerOrches sends a summary later

Operator sees:

- PowerShell console / Task Scheduler output
- gateway health JSON

Database:

- no database changes

Logs:

- host PowerShell output
- profile gateway logs

### Task 5-6 — scheduler / alerting

Customer sees:

- only optional Telegram alert messages if enabled

Operator sees:

- scheduled task result codes
- optional Telegram alert confirmation

Database:

- no database changes

Logs:

- Task Scheduler history
- watchdog stdout/stderr

## Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | The Windows host has `lms` on PATH for the same user that runs Task Scheduler. | No | High |
| A2 | Docker Desktop starts before or alongside the scheduled watchdog action. | No | High |
| A3 | The container name remains `hermes-sandbox`. | Yes | Medium |
| A4 | The shared always-on LM Studio model remains `google/gemma-4-26b-a4b-qat`. | Yes | Medium |
| A5 | Host-side Telegram alerting can be optional for Phase 1 and does not need to block the main watchdog rollout. | No | Low |
| A6 | The host user running Task Scheduler has permission to start Docker Desktop and LM Studio processes. | No | High |

## Open Questions

- Should Phase 1 ship with Telegram host alerts enabled by default, or disabled by default and only documented as optional?
- Does Nero want one watchdog loop for all profiles, or a one-shot recovery task at login plus a separate periodic scheduler task?

## Not In Scope

- changing HerVid / HerSocial / HerWiki business workflows
- redesigning Hermes core command registry
- removing the local `hermes-agent` patch dependency
- introducing a new infrastructure service outside the current Windows + Docker + LM Studio setup

## Verification Checklist

1. Run host startup flow manually:
   - `Start-HermesStack.ps1 -ShowStatus`
2. Run watchdog one-shot in healthy state:
   - `Watch-HermesStack.ps1 -RunOnce -ShowHealth`
3. Stop one profile intentionally and rerun watchdog:
   - verify only that profile is recovered
4. Interrupt LM Studio and rerun watchdog:
   - verify startup/recovery output is explicit
5. Collect HerOrches fleet health after each scenario:
   - `python3 /workspace/hermes-agent-plugin/scripts/herorches_collect_health.py --json --log-lines 20 --timeout-seconds 20`
6. Validate final documentation:
   - `docs/HERORCHES_MONITORING_RUNBOOK.md`
   - `docs/HERMES_WINDOWS_HOST_STARTUP_RUNBOOK.md`
   - `docs/HERMES_AUTOSTART.md` if touched

## Proposed Execution Order After Approval

1. Implement or normalize watchdog contract and output.
2. Verify single-profile recovery.
3. Verify LM Studio interruption recovery.
4. Document Task Scheduler operational path.
5. Validate optional Telegram alerts only if the core recovery path is already stable.
