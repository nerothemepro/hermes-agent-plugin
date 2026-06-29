# Hermes Multi-Bot Backlog

Date: 2026-06-29
Owner: Nero / internal operator track
Status: Active

## Purpose

This backlog is the working source of truth for packaging, governing, and evolving the multi-profile Hermes stack so it can be recreated on another machine by an internal technical operator.

It tracks the phased work needed to move from a working local setup to a reproducible deployable toolkit.

## Target Deployment Environment

Standard target environment:

- Docker Desktop on Windows or macOS
- `hermes-sandbox` as the shared runtime container
- local LLM host runtime on the machine:
  - LM Studio, or
  - Ollama

Optional media stack for `hervid`:

- ComfyUI
- LTX workflow support

## Audience

Primary audience:

- internal technical operators
- Nero's friends/peers who want to build a similar multi-HerBot system

This is not yet written for non-technical end users.

## In-Scope Full Stack

Profiles currently considered part of the portable full stack:

- `hervid`
- `herresearch`
- `herdev`
- `hertran`
- `herwiki`
- `hersocial`
- `herorches`

Service expectations:

- all profiles share the same Docker container runtime
- most profiles use local text models from LM Studio or Ollama
- `hervid` additionally depends on ComfyUI and LTX
- `herorches` is the operator/controller profile for health and bounded repair

## Current Baseline

Verified current baseline:

- HerOrches Telegram health command works
- all 7 profiles report healthy
- host startup script works on Windows host
- watchdog one-shot works on Windows host
- LM Studio, ComfyUI, and Wan2.1 health checks are reachable from the container

Latest completed milestone:

- Phase 1 is complete and verified on host

## Phase Overview

| Phase | Name | Status | Goal | Main output |
|---|---|---|---|---|
| 1 | Host Watchdog Automation | Completed | Recover LM Studio, Docker, and gateways automatically after reboot or partial failure | Host startup + watchdog scripts and runbooks |
| 2 | Hermes Core Patch Governance | In progress | Fork and govern local `hermes-agent` core patch so Telegram shortcut behavior is reproducible | User-controlled `hermes-agent` fork + patch inventory + maintenance runbook |
| 2.5 | Portable Stack Packaging Audit | Planned | Close documentation and packaging gaps so the stack can be rebuilt on another machine by an internal operator | Full-stack install/migration runbook + validation checklist + secret/model matrix |
| 3 | HerOrches Operator Command Expansion | Planned | Expand HerOrches into a stronger operator bot for diagnosis and bounded recovery | Stable Telegram operator commands and usage runbook |

## Phase Details

### Phase 1 — Host Watchdog Automation

Status:

- completed

Outcome:

- `Start-HermesStack.ps1` verified on Windows host
- `Watch-HermesStack.ps1 -RunOnce -ShowHealth` verified on Windows host
- deterministic exit behavior and bounded recovery path implemented

Reference docs:

- `docs/HERORCHES_PHASE_ROADMAP.md`
- `docs/HERORCHES_PHASE1_IMPLEMENTATION_PLAN.md`
- `docs/HERORCHES_MONITORING_RUNBOOK.md`
- `docs/HERMES_WINDOWS_HOST_STARTUP_RUNBOOK.md`

### Phase 2 — Hermes Core Patch Governance

Status:

- in progress

Progress so far:

- local shortcut patch audited and narrowed to four governed files
- Nero-controlled fork created: `https://github.com/nerothemepro/hermes-agent`
- governed branch pushed: `feature/herorches-shortcuts-governance`

Goal:

- move current local `hermes-agent` shortcut/command-registry divergence into a user-controlled fork
- make upgrades and rebase work explicit instead of relying on undocumented local edits

Scope:

- audit current local changes under `/workspace/hermes-agent`
- classify patch slices:
  - Telegram command registry / slash shortcuts
  - background command handling
  - tests covering the patch
- create a user-controlled fork strategy
- push the patch into that fork
- document upstream sync / rebase procedure

Exit signal:

- fork exists under Nero-controlled GitHub
- required patches are committed there
- local environment can be rebuilt from fork + plugin docs without hidden local edits

Known dependency:

- fork target resolved: `https://github.com/nerothemepro/hermes-agent`

### Phase 2.5 — Portable Stack Packaging Audit

Status:

- planned

Goal:

- make the entire HerBot stack reproducible on another machine for an internal technical operator

Why after Phase 2:

- packaging docs should point at a stable source of truth for `hermes-agent`
- documenting portability before patch governance would preserve an unsafe hidden dependency

Scope:

- create a single full-stack install/migration runbook
- document host prerequisites for Windows and macOS
- document Docker Desktop + `hermes-sandbox` expectations
- document LM Studio / Ollama alternatives for text-model runtime
- document optional `hervid` media stack with ComfyUI + LTX
- create a secret/config matrix:
  - Telegram bot tokens
  - Codex auth expectations
  - Browser Use / browser automation keys if required
  - Facebook page token if `hersocial` is included
- create an operator validation checklist:
  - startup pass
  - watchdog pass
  - HerOrches `/health-all` pass
  - HerResearch pass
  - HerWiki ingest pass
  - HerSocial dry-run pass
  - HerVid smoke pass when media stack is installed

Exit signal:

- an internal operator can rebuild the stack on a fresh target machine using repository docs only, with no undocumented tribal knowledge

### Phase 3 — HerOrches Operator Command Expansion

Status:

- planned

Goal:

- deepen HerOrches into a practical operator bot for diagnosis and safe recovery

Primary command set target:

- `/health-all`
- `/health <profile>`
- `/diag <profile>`
- `/tail <profile> [lines]`
- `/recover <profile>`
- `/recover-all`
- `/models`
- `/deps`
- `/incidents`

Exit signal:

- most common fleet incidents can be diagnosed and handled from Telegram without dropping to manual shell commands

## Recommended Execution Order

1. Phase 2 — Hermes Core Patch Governance
2. Phase 2.5 — Portable Stack Packaging Audit
3. Phase 3 — HerOrches Operator Command Expansion

## Not In Scope Yet

- non-technical consumer installer UX
- one-click desktop installer
- automatic provisioning of third-party secrets
- replacing the current Docker Desktop + local model architecture
- full Hervid quality/creative workflow redesign beyond required portability notes

## Open Items To Resolve Later

- whether Ollama parity docs should be best-effort or fully validated before declaring portable support
- whether `hersocial` should be treated as default full-stack or optional due to Facebook token churn
- whether `browser-use` is part of the standard portable bundle or an optional add-on for `herresearch`

## Immediate Next Step

Proceed to Phase 2 planning and execution for the `hermes-agent` fork.
