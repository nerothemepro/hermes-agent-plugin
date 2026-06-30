# HerStack Phase 2.5 Portability Implementation Plan

Date: 2026-06-29
Phase: Portable Stack Packaging Audit
Status: Draft for approval
Next skill after approval: `sdtk-code-execute`

## Scope Summary

This phase closes the documentation and packaging gaps required to rebuild the full Hermes multi-bot stack on another machine for an internal technical operator.

Target outcome:

- a single operator can rebuild the full stack on a fresh Windows or macOS machine using repository docs only
- the rebuilt stack can target either LM Studio or Ollama as the local text-model runtime
- the packaged instructions clearly separate required core stack vs optional media stack
- the governed `hermes-agent` fork becomes part of the documented source-of-truth install path

This phase focuses on documentation, packaging rules, operator validation, and rebuild readiness. It does not redesign bot workflows.

Acceptance boundary:

- one full-stack migration runbook exists
- host prerequisites are explicit for Windows and macOS
- core runtime matrix is explicit: Docker Desktop + hermes-sandbox + LM Studio/Ollama
- optional `hervid` media stack is documented separately with ComfyUI + LTX notes
- secret/config matrix exists for all supported bots and integrations
- end-to-end operator validation checklist exists
- docs index and bootstrap reading order are updated to point at the new portability source-of-truth

## Existing Baseline

Already available:

- profile creation runbook
- multi-profile operations handbook
- Windows host startup runbook
- HerOrches monitoring runbook
- governed `hermes-agent` fork and governed branch
- GenVideo package docs and model inventory

Current gap:

- docs are still distributed across multiple runbooks and assume too much local knowledge
- there is no single full-stack rebuild guide
- LM Studio vs Ollama runtime support is not yet documented as an explicit decision tree
- media stack requirements for `hervid` are mixed with general Hermes packaging docs

## Dependency Notes

- Depends on the governed `hermes-agent` fork already existing
- Depends on keeping `hermes-agent-plugin` as the operator packaging repo
- Depends on documenting what remains optional instead of trying to validate every optional integration immediately
- Depends on preserving clear separation between core text-bot stack and optional media/browser/social extensions

## Task List In Execution Order

### 1. Define the portable stack boundary

Purpose:

- decide exactly what is part of the standard portable bundle and what is optional

Files likely to change:

- `docs/BACKLOG.md`
- new portability runbook docs

Verification:

- explicit sections for:
  - core stack
  - optional `hervid` media stack
  - optional browser automation add-ons
  - optional social posting integrations

Rollback / containment:

- if scope grows too wide, keep the portable bundle core-first and move extras to optional appendices

### 2. Create a single full-stack rebuild runbook

Purpose:

- give operators one ordered document to rebuild the stack from zero on another machine

Files likely to change:

- new full-stack install/migration runbook in `docs/`
- docs index

Verification:

- runbook order covers:
  - host prerequisites
  - clone repos
  - fork-aware source selection
  - Docker Desktop / container startup
  - profile creation/config
  - LM Studio or Ollama model/runtime setup
  - HerOrches health validation

Rollback / containment:

- if one document becomes too dense, keep one main runbook plus short linked appendices rather than many peer-level docs

### 3. Write prerequisite and runtime matrix

Purpose:

- remove ambiguity about supported host/runtime combinations

Files likely to change:

- portability runbook
- possibly `README.md` or a dedicated environment matrix doc

Verification:

- matrix explicitly covers:
  - Windows + Docker Desktop + LM Studio
  - Windows + Docker Desktop + Ollama
  - macOS + Docker Desktop + LM Studio
  - macOS + Docker Desktop + Ollama
- each path marks validated vs best-effort

Rollback / containment:

- if Ollama parity is not fully validated, mark it best-effort instead of overclaiming support

### 4. Create secret and config matrix

Purpose:

- ensure operators know which secrets/configs are mandatory, optional, or per-profile

Files likely to change:

- new secret/config matrix doc or section in the portability runbook

Verification:

- covers at minimum:
  - Telegram bot token per profile
  - Telegram allowed user / home channel
  - Codex auth expectation for `herorches`
  - Facebook page token for `hersocial`
  - Browser Use or Playwright-related keys if used
  - profile model/runtime assignments

Rollback / containment:

- if a secret is optional, document it as optional and keep the validation checklist split accordingly

### 5. Separate core validation from optional extension validation

Purpose:

- prevent optional stacks from blocking core rebuild success

Files likely to change:

- portability runbook
- validation checklist doc

Verification:

- core checklist includes:
  - host startup pass
  - watchdog pass
  - HerOrches `/health-all` pass
  - HerResearch basic reply pass
  - HerTran basic drafting pass
  - HerWiki basic ingest/query pass
- optional checklist includes:
  - HerVid smoke
  - HerSocial dry-run/live validation
  - browser automation checks

Rollback / containment:

- if any optional integration is unstable, keep it explicitly outside the core success gate

### 6. Document repo/source-of-truth mapping

Purpose:

- make clear which repo owns which part of the stack

Files likely to change:

- portability runbook
- docs index

Verification:

- mapping clearly distinguishes:
  - `hermes-agent` fork = Hermes core governed patch source
  - `hermes-agent-plugin` = packaging, profiles, runbooks, scripts
  - optional external repos/services = media/wiki/social/browser dependencies

Rollback / containment:

- if any ownership line is blurry, state the current temporary boundary explicitly instead of leaving it implicit

### 7. Add operator validation checklist

Purpose:

- give the operator a deterministic end-of-install proof list

Files likely to change:

- new checklist doc or appendix

Verification:

- includes concrete commands/prompts for:
  - host startup
  - watchdog
  - profile status
  - HerOrches `/health-all`
  - HerResearch reply
  - HerWiki ingest/query
  - optional HerVid/HerSocial/browser checks

Rollback / containment:

- if live third-party services are too variable, define expected dry-run checks as the minimum proof

## Architecture Review Notes

### Data flow boundaries

- `hermes-agent` fork owns Hermes core behavior
- `hermes-agent-plugin` owns packaging, host scripts, runbooks, profile bootstrap, and operator workflow
- host runtime owns local LLM engine choice: LM Studio or Ollama
- optional stacks own their own extended service dependencies: ComfyUI/LTX, browser tooling, Facebook APIs

### State transitions

Important lifecycle states:

- local working stack with tribal knowledge
- governed fork established
- portable runbook created
- fresh-machine operator rebuild becomes deterministic
- optional extensions validated separately from core stack

### Dependency graph risks

- mixing optional stacks into the core install path will make rebuilds brittle
- overclaiming Ollama parity without validation will create false portability confidence
- failing to declare repo ownership boundaries will recreate the current ambiguity

### Performance / operational hotspots

- low code risk, high operator-clarity risk
- the main failure mode is not runtime correctness but incomplete or misleading packaging instructions

### Observability coverage

Minimum operator signals needed:

- host startup output
- watchdog output
- HerOrches health JSON
- profile status commands
- model/runtime visibility checks
- optional service-specific smoke outputs

## Happy / Missing / Empty / Error Path Review

### Happy path

- operator follows the main runbook
- core stack comes up
- optional integrations are enabled only when needed
- validation checklist passes for chosen stack level

### Missing-input path

- operator does not have Facebook token, Browser Use key, or media stack
- core stack still succeeds
- optional sections are skipped cleanly

### Empty / no-op path

- operator wants only core text bots without Hervid/browser/social extras
- runbook still gives a valid reduced install path

### Error path

- wrong runtime selected
- governed fork not used
- Docker/container path differs from assumptions
- optional dependency missing but is mistakenly treated as required

## Observable State Notes

### Task 2-7 — portability packaging work

Customer sees:

- nothing directly; this is operator-facing packaging work

Operator sees:

- clearer source-of-truth docs
- deterministic install steps
- explicit validation commands and prompts

Database:

- none

Logs:

- command outputs captured during future rebuild validation

## Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | Internal operators are comfortable with Docker Desktop, terminal commands, and editing `.env`-style configs. | No | Medium |
| A2 | LM Studio remains the primary validated local runtime path; Ollama can initially be documented as best-effort if needed. | No | Medium |
| A3 | `hervid` can be treated as an optional extension stack with ComfyUI + LTX rather than a hard requirement for all operators. | Yes | Low |
| A4 | `hersocial` should remain part of the documented full stack, but its live-post validation can stay optional due to token churn. | No | Medium |
| A5 | Browser automation should be documented as optional for `herresearch`, not part of the minimum core success gate. | No | Low |

## Open Questions

- Should Ollama support be declared best-effort now, or do you want a later explicit validation phase before packaging claims it as supported?
- Should `hersocial` stay in the advertised default full stack, or be labeled optional-but-supported because of third-party token churn?
- Should browser automation be documented primarily as Playwright MCP, Browser Use, or both?

## Not In Scope

- implementing new HerOrches commands
- redesigning Hervid generation quality workflows
- replacing Docker Desktop with another orchestration model
- building a one-click consumer installer

## Verification Checklist

1. Inventory current docs and map gaps against the target portable stack.
2. Write the main full-stack rebuild runbook.
3. Add host/runtime matrix with validated vs best-effort labels.
4. Add secret/config matrix.
5. Add core-vs-optional validation checklist.
6. Update docs index and bootstrap order.
7. Review final docs for operator clarity and missing hidden steps.

## Proposed Execution Order After Approval

1. Define the portable bundle boundary.
2. Create the full-stack rebuild runbook.
3. Add runtime/prerequisite matrix.
4. Add secret/config matrix.
5. Add operator validation checklist.
6. Update index/bootstrap docs.
7. Review the docs as an internal operator would use them on a fresh machine.
