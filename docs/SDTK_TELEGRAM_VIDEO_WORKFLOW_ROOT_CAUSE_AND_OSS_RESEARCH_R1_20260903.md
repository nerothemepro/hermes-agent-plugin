# SDTK Telegram Video Workflow: Root-Cause Audit and OSS Research R1

Date: 2026-09-03

## Executive decision

The recurring failures are not primarily Telegram bugs, model-quality bugs, or isolated adapter bugs. The system currently distributes workflow ownership across Telegram router code, a custom controller, `sdtk-agent`, Hermes native Kanban cards, evidence parsers, a projector, and monitoring jobs. A language model is also allowed to produce protocol-critical completion metadata. This creates multiple competing state machines and lets malformed worker output corrupt the boundary between otherwise useful work and the canonical ledger.

Do not continue patching individual EP2 failures. Keep SDTK's policy, evidence, quality gates, and product-specific stages, but replace the execution boundary with one deterministic durable controller. The lowest-risk route is a two-step architecture:

1. Stabilize the current stack with a local append-only event store, transactional outbox, typed worker-result SDK, one retry owner, and real end-to-end tests using actual Hermes workers.
2. Evaluate Temporal as the durable execution kernel after the protocol is stable. Temporal already provides signals, queries, cancellation, heartbeats, retry history, and worker versioning; migrating first would mix a platform migration with an unresolved protocol redesign.

Telegram must remain an input/output adapter. HerOrches must not be the workflow engine, and no LLM should serialize canonical state transitions.

## Evidence from the current system

### Current failed run

Run `run_mtksv396_a0d7d9` is terminally blocked, not productively running:

- `research_evidence`: `external_evidence_invalid` / `HERMES_EVIDENCE_INVALID`.
- The HerResearch card reached native `done`, but its result was null and its artifact metadata was malformed text rather than the required structured evidence fields.
- `episode_lessons`: native Hermes card is `blocked/gave_up` after two 14-iteration attempts, while the SDTK ledger still recorded it as `running_external` during the failure window.
- Every downstream stage is blocked by dependency propagation.

This is a protocol failure. The worker found useful information, but the workflow could not safely consume it.

### Historical pattern

The sampled EP2/self-service runs show repeated failure at different integration boundaries:

| Run | Outcome | Dominant failure |
|---|---|---|
| `run_mssff5si_c0bf25` | blocked | external evidence reconciliation |
| `run_msy31he0_50cd5d` | cancelled | capture/render dispatch and profile context |
| `run_mszg94zp_15d03b` | blocked | missing canonical render-output contract |
| `run_mt1kcegw_7f3fe8` | blocked | capture/render dependency boundary |
| `run_mtjr33h0_953c5b` | cancelled | controller/router availability |
| `run_mtjs321l_d4c5e3` | cancelled | semantically invalid evidence despite task completion |
| `run_mtksv396_a0d7d9` | blocked | malformed structured evidence and worker budget exhaustion |

The location changes, but the shape is stable: a task is prepared or performed, state crosses a loosely typed boundary, and the controller, adapter, native card, or projection disagrees about what happened.

## Root causes

### RC-1: There is no single state owner

At least six components infer or mutate lifecycle state: Telegram router, video controller, `sdtk-agent` ledger, Hermes card, reconciler, and Kanban projector. A projector should never need to infer truth from two mutable stores. The canonical state must be produced once, then projected.

### RC-2: Protocol-critical output is model-authored

Hermes agents are being asked to both perform reasoning and correctly encode completion metadata. The latest run proves that useful prose and a valid protocol result are independent. Free-form model output must be treated as an untrusted artifact. A deterministic wrapper must validate files, calculate hashes, construct `result.json`, and submit completion.

### RC-3: The control path is synchronous where work is asynchronous

Telegram acknowledgements previously waited on controller/CLI operations long enough to time out. The correct command contract is: validate and enqueue transactionally, return a run ID immediately, then report state changes asynchronously.

### RC-4: Tests verify components, not the release topology

The disposable smoke test intentionally avoided Hermes and Telegram and used a manual adapter. It proved the controller in isolation but not the actual contract that repeatedly fails: real worker claim, execution, typed evidence completion, reconciliation, owner signal, notification, and projection.

### RC-5: Retry ownership is duplicated

Hermes dispatcher retries, SDTK reconciliation, router behavior, and manual recovery can all influence the same failed work. This produces `gave_up`, stale external tasks, and duplicate-protection behavior that reuses a poisoned run. Exactly one layer must own attempts and backoff.

### RC-6: Worker scope and budget are not stage-specific

HerWiki exhausted two 14-iteration runs while searching broadly. Each stage needs a bounded input manifest, fixed output schema, explicit command allowlist, and task-specific budget. Retrieval should be deterministic before the model is asked to synthesize.

### RC-7: Runtime versions can change underneath a run

The lane repeatedly required package publish, hot deploy, profile alias changes, and router restarts while runs were active. A run must pin controller version, adapter version, workflow manifest hash, model policy, and worker image/release ID at kickoff.

### RC-8: Observability is polling plus interpretation, not event delivery

The dashboard and Telegram notifier do not consume one authoritative state-change stream. This causes stale “running” states, missing transitions, and no reliable owner notification when a task changes state.

## Open-source research

Source was shallow-cloned and inspected under `/workspace/research/video-workflow-oss-20260903/`.

| Project | What its source demonstrates | Apply to SDTK | Do not copy blindly |
|---|---|---|---|
| [Temporal TypeScript samples](https://github.com/temporalio/samples-typescript) | Signals and queries for human gates; activity heartbeat/resume; cancellation; worker versioning | Durable owner approvals, heartbeat-based stale detection, replayable state, pinned worker versions | A migration does not fix SDTK's malformed evidence contract by itself |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Waitpoint tokens, idempotency keys, checkpoint/resume, realtime updates, atomic task versioning | Approval-token semantics, command dedupe, release locking, state-change subscriptions | Adds a substantial platform; avoid adopting only to replace a small local queue |
| [Kestra](https://github.com/kestra-io/kestra) | Explicit paused execution state, retries, worker/executor separation, human approval patterns | Formal lifecycle vocabulary and executor/worker ownership split | General orchestration UI is not a substitute for SDTK evidence and video gates |
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | Central task state, stage progress updates, preflight checks, atomic patching of existing tasks | Media-stage progress, output snapshots, never recreate deleted tasks during async callbacks | Its task state is simpler than SDTK's human-gated multi-agent workflow |
| [NarratoAI](https://github.com/linyqh/NarratoAI) | `step_current`, `step_total`, messages, and parsed ffmpeg progress callbacks | Concrete render progress for Kanban/Telegram instead of generic `running` | Progress percentages alone do not establish durable workflow correctness |
| [OpenX Flow](https://github.com/OpenX-Inc/flow) | Script-to-scenes pipeline, last-frame conditioning, post-production stages, basic SSIM/black-frame validation | Scene manifest/checkpoints and shot-level quality validation | Current scheduler is a simple loop; human approval and recovery are insufficient for SDTK |

The strongest finding is separation of concerns. Durable workflow engines own state and retries. Video systems own media stages and progress. SDTK currently asks Telegram, HerOrches, Hermes cards, and the agent ledger to jointly do both.

## Target architecture

```text
Telegram command
  -> Command inbox (command_id + idempotency key)
  -> Deterministic VideoWorkflow controller
       -> append-only run_events
       -> reduced current_state
       -> task leases / heartbeat / one retry policy
       -> owner gate tokens pinned to artifact SHA-256
       -> transactional outbox
            -> Telegram state-change notifier
            -> SDTK-WIKI Kanban projector
  -> Hermes stage worker
       -> writes artifacts only
       -> deterministic result helper validates files + hashes
       -> controller commits typed completion event
```

### Canonical invariants

1. One event stream is authoritative. Native cards and Kanban are projections.
2. Every command carries an idempotency key. Duplicate Telegram delivery returns the original outcome.
3. Every run pins release/version hashes at kickoff.
4. Every task transition has `expected_state` compare-and-swap semantics.
5. Every external task has a lease, heartbeat, deadline, and attempt number.
6. Only the controller retries. Workers and adapters report outcomes but do not independently retry.
7. Model output cannot mutate lifecycle state. It can only create candidate artifacts.
8. A deterministic validator creates the canonical evidence envelope.
9. Approval is a durable signal over `(run_id, gate_id, artifact_sha256)`.
10. Notifications and Kanban updates come from an outbox committed in the same transaction as the state event.

## Typed worker-result contract

Every stage must finish through a helper, not through free-form `hermes kanban complete` arguments:

```json
{
  "schema_version": "sdtk.video-task-result.v1",
  "run_id": "run_...",
  "task_id": "research_evidence",
  "attempt": 1,
  "status": "completed",
  "artifacts": [
    {"path": "reports/evidence_pack.md", "sha256": "...", "media_type": "text/markdown"}
  ],
  "validation": {
    "status": "pass",
    "validator": "research-evidence-r1",
    "evidence": ["reports/evidence_pack.check.json"]
  },
  "summary": "bounded text",
  "error": null
}
```

The helper checks path containment, existence, SHA-256, schema, stage-specific fields, and size limits before emitting `task_completed`. Invalid output becomes a typed `task_failed` event with a recoverability class; it never becomes a half-completed card.

## Notification design

HerOrches should report only material transitions, not poll noise:

- run accepted;
- task started;
- task completed;
- human gate waiting, with exact approval command and artifact hash;
- recoverable retry scheduled;
- blocked, with cause and operator action;
- run completed/cancelled.

Each notification has an outbox ID and delivery status. Telegram failure does not roll back workflow state; it remains retryable from the outbox. Kanban consumes the same events, so Telegram and web cannot disagree about lifecycle state.

## Implementation roadmap

### Phase 0: Freeze and diagnose

- Stop creating new EP2 runs through Telegram.
- Preserve current ledgers/cards as regression fixtures.
- Mark the current run blocked with its exact failure; do not reuse it.

Exit: a fixture pack reproduces malformed evidence, stale split state, duplicate command, timeout, cancellation, and worker budget exhaustion.

### Phase 1: Contract boundary

- Add `sdtk-video-task-result` schema and deterministic completion helper.
- Change Hermes prompts to write artifacts only.
- Make the adapter consume only validated envelopes.
- Add stage-specific result schemas for research, wiki lessons, capture, render, and social.

Exit: malformed metadata cannot enter canonical state; all historical malformed fixtures fail deterministically.

### Phase 2: Event store and reducer

- Add SQLite `commands`, `run_events`, `task_leases`, and `outbox` tables.
- Implement deterministic reducer and compare-and-swap transitions.
- Make `sdtk-agent` ledger a derived compatibility view during migration.
- Establish one retry matrix keyed by typed error class.

Exit: crash/restart/replay produces byte-equivalent current state and no duplicate dispatch.

### Phase 3: Worker execution and progress

- Replace profile-name inference with an explicit immutable worker routing table.
- Add leases and heartbeats.
- Emit stage progress modeled after NarratoAI: stage index, stage total, message, and ffmpeg/render progress.
- Bound HerResearch/HerWiki inputs before model execution.

Exit: killed worker is detected from lease expiry; restart resumes or retries exactly once.

### Phase 4: Approval, notification, and Kanban projection

- Implement SHA-pinned durable gate signals.
- Add transactional outbox consumers for Telegram and SDTK-WIKI Kanban.
- Remove lifecycle inference from the projector.
- Add state-change subscription/status command backed by the reducer.

Exit: Telegram and Kanban show the same state/event revision after restart and duplicate delivery.

### Phase 5: Real disposable E2E

Run a disposable environment that includes the production router, controller, `sdtk-agent`, real Hermes claim/worker completion path, local deterministic fixture workers, Telegram update fixture, notifier, and Kanban projector. It must cover prepare, kickoff, worker completion, approval, reject, retry, cancel, stale lease, duplicate update, bad evidence, and recovery.

Exit: 20 consecutive clean runs with zero manual repair, zero duplicate dispatch, zero state divergence, and complete notification delivery evidence.

### Phase 6: EP2 controller-led dogfood

- Start a fresh EP2 run pinned to one release.
- No source patch, npm publish, or hot deploy is allowed during the run.
- If a defect is found, terminate the run, fix in staging, rerun the full E2E suite, then start a new run.

Exit: EP2 completes from prepare through review artifact without direct ledger/card mutation.

### Phase 7: Telegram graduation

Enable self-service only after:

- 3 consecutive real episodes complete without manual state repair;
- owner approvals, reject, cancel, and recovery all pass;
- Telegram/Kanban divergence is zero;
- progress and blockers are delivered automatically;
- publishing remains a separate attended SHA gate.

## Temporal decision gate

After Phase 1 defines a clean protocol, run a bounded spike mapping one episode to Temporal Activities and Signals. Adopt Temporal if the spike demonstrates lower code/operations burden for replay, heartbeat, cancellation, approval, and version migration than maintaining the local event engine. Otherwise retain the SQLite engine. Do not adopt a generic video generator as the controller.

## Immediate recommendation

Choose **Architecture B: SDTK protocol first, durable engine second**.

- Near term: implement the deterministic event/outbox/result boundary in the existing TypeScript control plane.
- Reuse: Temporal signal/heartbeat/versioning semantics; Trigger.dev idempotent waitpoint semantics; NarratoAI/MoneyPrinterTurbo media progress; OpenX scene manifests and shot validators.
- Reject: more per-run router patches, model-authored metadata, duplicate retry loops, manual ledger mutation, and component-only smoke tests.

This is the shortest path that removes the class of failure instead of moving it to the next boundary.
