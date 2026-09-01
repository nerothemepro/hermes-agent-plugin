# SDTK Marketing Telegram Video Self-Service Master Plan R1

Date: 2026-09-01  
Status: CONTROLLER DESIGN APPROVED  
Owner: Nero  
Controller: Codex during dogfood  
Target operator: HerOrches through Telegram

## 1. Objective

Move the proven SDTK marketing-video workflow from controller-led dogfood to an attended Telegram self-service flow:

1. Owner selects an allowlisted episode from Telegram.
2. HerOrches prepares a bounded workflow preview.
3. Owner confirms kickoff.
4. Hermes profiles execute research, lessons, script, capture, render, social preparation, and lessons recording.
5. SDTK-AGENT keeps the canonical durable ledger.
6. SDTK-WIKI Kanban projects the ledger for web monitoring.
7. Owner intervenes only at Story Lock, Picture Lock, and Publish Approval.
8. External publishing remains attended and exact-SHA-gated.

Self-service does not mean unattended publishing, arbitrary Telegram prompts, automatic gate approval, or hidden recovery.

## 2. Proven Workflow Shape

```text
Telegram owner command
  -> deterministic episode manifest lookup
  -> preflight and cost/side-effect preview
  -> owner kickoff confirmation
  -> research_evidence       (HerResearch)
  -> episode_lessons         (HerWiki)
  -> script_package          (HerOrches)
  -> Story Lock              (Owner)
  -> product_capture         (HerDev)
  -> episode_render          (HerVid)
  -> Picture Lock            (Owner)
  -> social_package          (HerSocial)
  -> Publish Approval        (Owner, exact SHA)
  -> lessons_record          (HerWiki)
  -> final_report            (Controller)
```

Canonical execution truth is the SDTK-AGENT run ledger. Native Hermes Kanban cards are transport. Telegram messages, defect notes, and SDTK-WIKI Kanban documents are views or commands; none may override ledger state.

## 3. What Already Exists

| Capability | Current state | Evidence |
| --- | --- | --- |
| Fixed multi-profile workflow | Present | `control-plane/templates/marketing_video_ep_usage/template.json` |
| Seven worker dispatches and three owner gates | Present in controller-led design | `control-plane/video-dogfood/README.md` |
| Durable run ledger | Present | `.sdtk/agent-runtime/runs/` |
| Fixed EP2 Telegram prepare command | Partially proven | `/marketing-video ep2-usage` history and router implementation |
| Controller inspect/next/reconcile/continue | Present | `control-plane/video-dogfood/controller.js` |
| Per-role Hermes profile homes | Implemented in runtime map | EP2 template/runtime deployment evidence |
| SDTK-WIKI Kanban projection | Running | `control-plane/ep2-kanban/` and Supervisor projector |
| Video quality/evidence gates | Present in `sdtk-marketing` | EP1/EP2/EP3 dogfood improvements through `sdtk-marketing-kit@0.19.0` |
| Real terminal capture workflow | Present | terminal capture runner and EP2/EP3 evidence captures |
| Attended social preparation/publish | Present with owner approval | HerSocial SHA-gated publisher bridge |
| Controller-led EP3 final assembly | Proven | EP3 G6 output and receipt under `/workspace/video_projects/` |

## 4. Current Gaps And Defects

### 4.1 Existing open defects

| Defect | Severity | Gap | Required closure evidence |
| --- | --- | --- | --- |
| DEF-EP2-003 | P1 | Projector can represent dependency waits as blockers | Projection fixture maps ready/waiting states correctly and matches ledger snapshots |
| DEF-EP2-004 | P0 | HerVid worker may be non-spawnable in its profile context | Exact production-context preflight plus one claimed disposable card |
| DEF-EP2-005 | P1 | Capture-to-render handoff may lack canonical manifest | Hash-pinned capture manifest accepted by render worker without free-form discovery |
| DEF-EP2-006 | P1 | Evidence identity may depend on model-authored text | Adapter-owned evidence envelope; model output cannot choose run/task identity |
| DEF-EP2-007 | P1 | Explicit retry may reuse a prior idempotency attempt | Attempt increments before dispatch; repeated command creates no duplicate card |
| DEF-EP2-008 | P0 | Worker artifact may expose private machine telemetry | Isolated demo environment plus deterministic privacy scanner blocks fixture leak |
| DEF-EP2-009 | P0 | Dependency evidence is not always handed off deterministically | Worker input manifest pins dependency paths and SHA-256 values |

### 4.2 Newly confirmed gaps

| ID | Severity | Gap | Impact |
| --- | --- | --- | --- |
| DEF-TVSS-010 | P0 | Episode manifest drift: EP3 manifest says Preview Studio while the accepted EP3 is Second Brain | Telegram may successfully produce the wrong episode |
| DEF-TVSS-011 | P0 | No clean end-to-end Telegram run after the latest fixes | Current fixes are not integration-proven |
| DEF-TVSS-012 | P1 | Telegram command surface is EP2-specific instead of manifest-driven | New episodes require patches instead of configuration |
| DEF-TVSS-013 | P1 | Preflight is distributed across router, controller, adapter, and worker | Failures are discovered after run creation or dispatch |
| DEF-TVSS-014 | P1 | Recovery still depends on controller diagnosis for some stale/blocked states | Owner cannot rely on a concise actionable Telegram status |
| DEF-TVSS-015 | P1 | Historical blocked runs remain visible without a clear active-run policy | Dashboard can confuse history with current work |
| DEF-TVSS-016 | P1 | Quality gates and evidence contracts are not one version-pinned episode profile | A worker can run with a stale toolkit or wrong quality profile |
| DEF-TVSS-017 | P1 | Graduation evidence for EP2, EP3, and EP4 does not exist | Telegram self-service cannot be enabled honestly |

## 5. Root Causes

1. The workflow grew incrementally from EP2 incidents rather than from one versioned controller contract.
2. Episode content, orchestration state, worker routing, and quality policy are stored in separate places without one resolved manifest.
3. Some identity and evidence fields were inferred from model output instead of being injected by the adapter.
4. Preflight checks validated pieces independently, not the exact execution context used after dispatch.
5. Projector and monitor duplicated state interpretation instead of consuming a shared normalized state model.
6. Recovery patches were tested locally but not followed by a clean, patch-free end-to-end episode proof.
7. The owner-facing Telegram interface was added before the controller-led dogfood met graduation criteria.

## 6. Target Operating Contract

### Owner responsibilities

- Select an allowlisted episode.
- Confirm one kickoff preview.
- Approve or reject Story Lock.
- Approve or reject Picture Lock.
- Approve an immutable social packet by exact SHA.

### Controller responsibilities

- Resolve one versioned episode manifest.
- Run one consolidated preflight before creating or dispatching work.
- Create exactly one canonical run and one native card per task attempt.
- Inject identity and dependency evidence into each worker envelope.
- Reconcile native evidence into the ledger.
- Detect stale work and report one classified next action.
- Never approve gates or publish.

### Worker responsibilities

- Execute only the bounded instruction and evidence paths in the envelope.
- Produce structured result evidence and artifact hashes.
- Never infer run identity, create child tasks, approve gates, or publish.

### Projector responsibilities

- Read normalized canonical state.
- Show active and historical runs separately.
- Never mutate or approve workflow state.

## 7. Graduation Criteria

Telegram self-service can be proposed only after all items pass:

- EP2, EP3, and EP4 complete using one manifest-driven workflow shape.
- No source patch, package publish, or deployment occurs during each final successful attempt.
- No duplicate run, native task, video upload, or social post.
- Stale work is detected and classified with an actionable next step.
- Recovery resumes from a checkpoint without rewriting prior evidence.
- Kanban matches canonical ledger snapshots at every gate.
- All artifacts use reproducible absolute paths and SHA-256 values.
- Video passes the version-pinned quality profile and owner Picture Lock.
- Social payloads pass checks and owner exact-SHA Publish Approval.
- Owner intervention is limited to kickoff and the three approved gates.
- Every accepted defect fix has regression coverage and a later episode proof.
- Owner explicitly approves graduation; it is never automatic.

## 8. Delivery Roadmap

| Phase | Outcome | Exit gate |
| --- | --- | --- |
| R0: Truth alignment | Canonical series manifest matches accepted EP1-EP3 facts | Owner approves manifest diff |
| R1: Controller core | Shared state model, idempotency, evidence envelope, role roster | Unit and fixture tests pass |
| R2: Consolidated preflight | One command proves exact profile/toolkit/board/manifest execution context | Disposable preflight passes |
| R3: Telegram surface | Manifest-driven prepare/status/approve/cancel grammar | Router tests and no-side-effect smoke pass |
| R4: Monitor and projector | Ledger-consistent status, stale classification, active/history separation | Snapshot parity test passes |
| R5: Staging E2E | Disposable no-publish run reaches all three gates | No duplicates or manual repair |
| R6: Episode dogfood | EP2, EP3, EP4 complete in sequence | Graduation evidence packet complete |
| R7: Owner graduation decision | Enable or reject Telegram self-service | Explicit owner approval |

## 9. Out Of Scope

- Arbitrary natural-language workflow generation from Telegram.
- Automatic owner approval.
- Unattended external publishing.
- Editing historical run evidence to make a failed run appear successful.
- Deleting blocked or cancelled historical runs.
- Generalizing the controller beyond marketing video before graduation.

## 10. Current Decision

Approved direction: Controller Design A, a manifest-driven broker with deterministic worker envelopes and attended owner gates. See `SDTK_TELEGRAM_VIDEO_SELF_SERVICE_CONTROLLER_SPEC_R1_20260901.md`.

