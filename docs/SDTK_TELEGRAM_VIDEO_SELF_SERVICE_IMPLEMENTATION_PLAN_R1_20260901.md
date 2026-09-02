# SDTK Telegram Video Self-Service Implementation Plan R1

Date: 2026-09-01  
Status: PROPOSED - OWNER APPROVAL REQUIRED  
Approved design: `SDTK_TELEGRAM_VIDEO_SELF_SERVICE_CONTROLLER_SPEC_R1_20260901.md`  
Master plan: `SDTK_TELEGRAM_VIDEO_SELF_SERVICE_MASTER_PLAN_R1_20260901.md`

## 1. Scope Summary

Implement Controller Design A as a manifest-driven, attended Telegram workflow for SDTK marketing videos. The work closes the current EP2 reliability defects, removes episode-specific router code, centralizes preflight and evidence contracts, makes Kanban a faithful projection, and produces a clean dogfood path for EP2, EP3, and EP4.

Implementation spans three ownership boundaries:

| Repository | Ownership |
| --- | --- |
| `codexsdtk/sdtk-internal` | SDTK-AGENT state/retry semantics and Hermes adapter evidence/preflight/idempotency |
| `nerothemepro/hermes-agent-plugin` | Episode manifests, controller broker, consolidated preflight, monitor, projector, staging/deploy scripts |
| `nerothemepro/hermes-agent` | Minimal governed Telegram command grammar and router handoff |

The current dirty worktrees are not implementation targets. Execution begins in isolated worktrees based on each current `origin/main`, preserving all existing local files and changes.

## 2. Minimum Viable Change

The implementation will not create a generic workflow authoring system. It will:

1. Replace the mutable series entry as execution input with versioned episode manifests.
2. Reuse the existing seven-task, three-gate workflow shape.
3. Add one consolidated preflight and one adapter-owned worker envelope.
4. Generalize the exact Telegram command from EP2 to allowlisted episode IDs.
5. Normalize state once for controller, monitor, and projector consumers.
6. Prove the system in staging before any live Telegram dogfood.

## 3. Dependency Order

```text
Task 0 baseline/isolation
  -> Task 1 manifest truth
  -> Task 2 normalized state contract
  -> Task 3 adapter envelope/idempotency
  -> Task 4 core retry/reconcile semantics
  -> Task 5 consolidated preflight
  -> Task 6 controller command surface
  -> Task 7 Telegram router
  -> Task 8 monitor/projector parity
  -> Task 9 evidence/privacy/quality gate
  -> Task 10 staged release and deployment
  -> Task 11 disposable E2E smoke
  -> Task 12 EP2/EP3/EP4 dogfood
  -> Task 13 graduation report
```

Tasks 3 and 4 are released together. Tasks 6 through 9 consume those published package versions. No production package changes occur during a dogfood episode.

## 4. Task Plan

### Task 0 - Establish clean baselines and fixture inventory

Purpose:

- Protect the existing dirty worktrees.
- Record current package/runtime versions and failing fixtures before modification.
- Create isolated worktrees for all three repositories.

Likely paths:

- New worktrees under each repository's existing `.worktrees/` convention.
- Evidence under `docs/reviews/telegram-video-self-service/` in the plugin worktree.

Actions:

1. Fetch `origin/main` read-only for all three repos.
2. Create named feature worktrees without modifying current branches.
3. Record current tests, package versions, router grammar, open defects, active Supervisor programs, and historical run IDs.
4. Create sanitized fixtures for terminal states and blocked EP2 ledgers.

Verification:

```bash
git status --short
git rev-parse HEAD
node --test test/hermesControlPlane.test.js test/hermesControlPlanePrepare.test.js
node --test control-plane/video-dogfood/test-controller.js
node --test control-plane/ep2-kanban/test-project-kanban.js
python3 -m unittest control-plane/monitor/test_monitor.py
```

Rollback/containment: remove only newly created worktree registrations after explicit owner approval; never clean the current dirty trees.

### Task 1 - Introduce versioned episode manifests and fix content drift

Purpose: close `DEF-TVSS-010` and make episode content immutable per run.

Repository: `hermes-agent-plugin`.

Likely files:

- `control-plane/video-self-service/episodes/EP2.r1.json`
- `control-plane/video-self-service/episodes/EP3.r1.json`
- `control-plane/video-self-service/episodes/EP4.r1.json`
- `control-plane/video-self-service/episode-manifest.js`
- `control-plane/ep2-kanban/marketing-video-series.json`
- generic replacement for `src/hermesControlPlaneEp2.js`
- `test/hermesControlPlane.test.js`

Actions:

1. Encode EP1 completion, EP2 Usage/Real AI Cost, EP3 Second Brain, and proposed EP4 truth in the series manifest.
2. Create schema-validated execution manifests for allowlisted EP2-EP4.
3. Include story, pain point, product proof, source boundaries, CTA, language, workflow revision, quality profile, and required package versions.
4. Hash the resolved manifest and include it in preview and registry records.
5. Reject missing, stale, malformed, or unallowlisted manifests.

Verification:

```bash
node --test test/hermesControlPlane.test.js test/hermesControlPlanePrepare.test.js
node bin/hermes-control-plane preview --template marketing_video_ep_usage --params '{"episode":"EP3"}'
```

Required assertions:

- EP3 resolves to Second Brain, not Preview Studio.
- Changing one manifest byte changes the manifest SHA and prevents reuse of an older run.
- EP5 and arbitrary instructions fail closed.

Rollback: retain the existing r3 template as a disabled compatibility fixture; active resolution can be switched back without deleting manifests.

### Task 2 - Create one normalized controller state model

Purpose: close `DEF-EP2-003`, `DEF-TVSS-014`, and `DEF-TVSS-015`.

Repository: `hermes-agent-plugin`.

Likely files:

- `control-plane/video-self-service/normalized-state.js`
- `control-plane/video-dogfood/controller.js`
- `control-plane/ep2-kanban/project-kanban.js`
- `control-plane/monitor/hermes_control_plane_monitor.py`
- corresponding JS/Python tests

Actions:

1. Define terminal run states and normalized task/gate states once.
2. Map `waiting_for_dependency` to `PENDING`, never blocker.
3. Separate active run selection from historical terminal runs.
4. Emit one blocker class and one next action for every attention state.
5. Make controller status, monitor message, and Kanban projection consume the same normalized payload.

Verification:

```bash
node --test control-plane/video-dogfood/test-controller.js
node --test control-plane/ep2-kanban/test-project-kanban.js
python3 -m unittest control-plane/monitor/test_monitor.py
```

Fixture matrix: `prepared`, `running`, `waiting_for_approval`, `waiting_for_dependency`, `running_external`, `blocked`, `failed`, `cancelled`, `completed`, malformed/missing state.

Rollback: projector and monitor retain read-only behavior; the normalized module can be feature-flagged off.

### Task 3 - Move worker identity, dependency evidence, and idempotency into the Hermes adapter

Purpose: close `DEF-EP2-005`, `DEF-EP2-006`, `DEF-EP2-007`, and `DEF-EP2-009` at the correct ownership boundary.

Repository: `sdtk-internal`, package `sdtk-agent-hermes-adapter`.

Likely files:

- `products/sdtk-agent/adapters/hermes/index.js`
- `lib/payload.js`
- `lib/backends/kanban-cli.js`
- `lib/profiles.js`
- new envelope/schema helper under `lib/`
- adapter contract tests

Actions:

1. Generate adapter-owned envelope fields: run, task, attempt, idempotency key, manifest SHA, profile, board, dependencies, and output root.
2. Pass dependencies as validated path/SHA records; workers do not discover them.
3. Derive identity from controller context and reject only explicit contradictory worker values.
4. Query native cards by idempotency key before creation.
5. Resolve profile spawnability from the central roster and dispatcher home used by real dispatch.
6. Return bounded structured preflight and evidence errors.

Verification:

```bash
cd products/sdtk-agent/adapters/hermes
node --test test/*.test.js
npm pack --dry-run
```

Required tests:

- same attempt returns the same card;
- next attempt creates exactly one new card;
- missing dependency file or hash fails before dispatch;
- model prose cannot replace envelope identity;
- unknown/unspawnable profile fails preflight;
- empty/malformed completion never releases downstream work.

Rollback: package remains unpublished until tests and disposable live preflight pass; prior package stays active through the staging pointer.

### Task 4 - Harden SDTK-AGENT retry and reconciliation semantics

Purpose: make retries and checkpoint recovery canonical rather than controller-specific.

Repository: `sdtk-internal`, package `sdtk-agent-kit`.

Likely files:

- `src/lib/runner.js`
- `src/lib/state-machine.js`
- `src/commands/task.js`
- `src/commands/run.js`
- `test/external-reconcile.test.js`
- new retry/idempotency tests

Actions:

1. Increment and persist attempt before external dispatch.
2. Preserve prior external IDs and evidence as immutable attempt history.
3. Reconcile completed native evidence without creating a replacement card.
4. Allow one audited retry grant only for classified recoverable failures.
5. Keep downstream tasks pending until new evidence validates.
6. Emit explicit retry, reuse, reconciliation, and terminal-block events.

Verification:

```bash
cd products/sdtk-agent/distribution/sdtk-agent-kit
node --test test/*.test.js
npm pack --dry-run
```

Rollback: no in-place ledger migration. New fields are additive and absent fields are treated conservatively.

### Task 5 - Build a consolidated exact-context preflight

Purpose: close `DEF-EP2-004`, `DEF-TVSS-013`, and `DEF-TVSS-016` before dispatch.

Repository: `hermes-agent-plugin`, consuming Task 3/4 packages.

Likely files:

- `control-plane/video-self-service/preflight.js`
- `control-plane/video-self-service/toolchain-policy.json`
- `control-plane/video-dogfood/controller.js`
- `bin/hermes-control-plane`
- tests and disposable fixtures

Actions:

1. Validate manifest, duplicate active run, package versions, role roster, profile spawnability, board access, tools, output roots, quality profile, privacy scanner, and publish-disabled policy.
2. Execute checks with the same `PATH`, `NODE_PATH`, `HERMES_HOME`, board, and profile later used for dispatch.
3. Produce a bounded preflight packet and SHA.
4. Make prepare read-only until preflight passes.

Verification:

```bash
node --test control-plane/video-self-service/test-preflight.js
node bin/hermes-control-plane preflight --episode EP3 --json
```

Failure fixtures: missing profile, stale package, unavailable renderer, unwritable output, missing quality profile, active duplicate run, forbidden publish flag.

Rollback: a feature flag keeps current controller-led prepare available; failed preflight has zero side effects.

### Task 6 - Implement the manifest-driven controller command surface

Purpose: replace episode-specific controller logic with one bounded broker.

Repository: `hermes-agent-plugin`.

Likely files:

- `control-plane/video-self-service/controller.js`
- `control-plane/video-self-service/commands.js`
- `bin/hermes-control-plane`
- registry/controller tests
- compatibility wrapper in `control-plane/video-dogfood/controller.js`

Actions:

1. Implement prepare, kickoff, status, gate approve/reject, cancel, reconcile, and classified recovery.
2. Require manifest/preflight/packet SHA at every mutation boundary.
3. Enforce one active run per episode revision.
4. Keep publication outside the controller.
5. Return bounded JSON for Telegram.

Verification:

```bash
node --test control-plane/video-self-service/test-controller.js
node --test test/hermesControlPlane*.test.js
```

No-op tests: duplicate kickoff, repeated status, repeated gate approval, stale SHA, terminal cancellation, empty reason code.

Rollback: compatibility alias calls the new controller; disabling the new flag returns to controller-led operation without deleting runs.

### Task 7 - Update the governed Telegram router

Purpose: close `DEF-TVSS-012` while keeping Telegram fail-closed.

Repository: `hermes-agent` fork.

Likely files:

- `gateway/control_plane_router.py`
- `tests/gateway/test_control_plane_router.py`
- `docs/control-plane/telegram-command-router.md`

Actions:

1. Add exact Design A grammar.
2. Validate owner ID and home channel before parsing.
3. Route to plugin controller argv with bounded timeout and output parsing.
4. Keep legacy `/marketing-video ep2-usage` as a deprecated alias.
5. Return a concise result and exact next command without raw stderr.

Verification:

```bash
pytest -q tests/gateway/test_control_plane_router.py tests/gateway/test_pre_gateway_dispatch.py
```

Security tests: non-owner/channel drop, natural-language refusal, extra arguments, malformed IDs/hashes, timeout, and invalid controller JSON.

Rollback: set `control_plane_router.marketing_video_self_service_enabled: false`; normal gateway passthrough remains.

### Task 8 - Align monitor and Kanban projection

Purpose: make web and Telegram status trustworthy.

Repository: `hermes-agent-plugin`.

Likely files:

- `control-plane/monitor/hermes_control_plane_monitor.py`
- `control-plane/ep2-kanban/project-kanban.js`
- Supervisor configs and runbook
- monitor/projector tests

Actions:

1. Consume normalized state.
2. Project active episode separately from terminal history.
3. Display manifest revision/SHA, attempt, gate SHA, heartbeat, blocker class, and next action.
4. Deduplicate notifications by run/task/status/attempt.
5. Keep monitor mutation limited to bounded reconciliation; no approval, retry, cancel, or publish.

Verification:

```bash
python3 -m unittest control-plane/monitor/test_monitor.py
node --test control-plane/ep2-kanban/test-project-kanban.js
```

Parity requirement: controller status, Telegram summary, `SHARED_PLANNING.md`, and `QUALITY_CHECKLIST.md` agree for every fixture.

Rollback: stop only new projector/monitor programs and restore prior Supervisor includes; ledgers remain untouched.

### Task 9 - Enforce evidence, privacy, and quality profiles

Purpose: close `DEF-EP2-008` and prevent stale/low-quality toolchains.

Repositories: `hermes-agent-plugin` and, only if a generic check is absent, `sdtk-marketing` in `sdtk-internal`.

Likely files:

- `control-plane/video-self-service/evidence-policy.js`
- privacy fixtures/scanner tests
- versioned quality profile
- generic `sdtk-marketing` gate modules only where necessary

Actions:

1. Validate canonical paths/hashes and dependency envelope.
2. Scan for secrets, Telegram identifiers, private home paths, and unallowlisted telemetry.
3. Require labelled demo data where operator data could appear.
4. Pin video quality profile and toolkit version for the complete run.
5. Quarantine failed references without deleting files.

Verification:

```bash
node --test control-plane/video-self-service/test-evidence-policy.js
sdtk-marketing check --stdin --strict --json < fixture-script.txt
```

Rollback: block handoff, retain validation history, delete nothing.

### Task 10 - Package, stage, release, and deploy atomically

Purpose: ensure router, controller, monitor, projector, agent, and adapter use one tested release identity.

Actions:

1. Merge/publish agent and adapter only after package tests.
2. Pin exact versions in toolchain policy and manifests.
3. Install an immutable staging release.
4. Run release verification and disposable preflight.
5. Activate one release pointer atomically.
6. Deploy controller/router with backups and restart only affected programs.
7. Verify health and active release identity.

Verification:

```bash
npm view sdtk-agent-kit@<version> version
npm view sdtk-agent-hermes-adapter@<version> version
bash control-plane/video-dogfood/staging/verify-release.sh <release_id>
supervisorctl -c control-plane/supervisord/supervisord.conf status
```

Observable state:

- Owner sees: no run or Telegram post during deployment.
- Operator sees: backup path, release ID, versions, process health.
- Ledger: unchanged.
- Logs: bounded summaries without secrets.

Rollback: reactivate the previous verified release pointer and restart only affected services. Retain backups and all run data.

### Task 11 - Run a disposable no-publish E2E smoke

Purpose: prove integrations before spending an episode attempt.

Flow:

1. Use an allowlisted smoke manifest and disposable evidence.
2. Exercise prepare, kickoff, research/wiki, Story Lock fixture, capture, render fixture, Picture Lock fixture, social packet, Publish Approval fixture, lessons, and report.
3. Capture ledger/projector parity at every transition.
4. Repeat kickoff/status/gate commands to prove idempotency.
5. Inject one stale worker and one invalid evidence artifact.

Required evidence:

- one completed disposable ledger;
- zero duplicate cards;
- zero external publish calls;
- parity snapshots;
- stale classification/checkpoint recovery receipt;
- all test suites passing against active staging release.

Rollback: retain disposable fixtures for review; no production account or episode state is touched.

### Task 12 - Dogfood EP2, EP3, and EP4 through Telegram

Purpose: create real graduation evidence.

Sequence:

1. Complete a fresh EP2 run.
2. Close defects only with regression evidence and subsequent proof.
3. Complete EP3 Second Brain with the same controller shape.
4. Complete EP4 using only a new manifest, with no controller/router code change.
5. Owner performs kickoff and exactly three gates per episode.
6. Publishing remains attended and exact-SHA-gated.

Hard stops:

- mid-run source patch/package publish/deploy;
- duplicate run/card/upload/post;
- manifest/evidence hash mismatch;
- privacy failure;
- unexplained Kanban/ledger divergence;
- owner intervention beyond approved gates except external blockers.

Failed attempts remain historical. Corrections resume from audited checkpoint or start a new run according to the state contract.

### Task 13 - Produce graduation decision packet

Purpose: let the owner decide whether self-service is ready.

Artifacts:

- EP2/EP3/EP4 run IDs and final reports;
- manifest and approval SHAs;
- defect closure matrix;
- duplicate/stale/recovery metrics;
- Kanban parity evidence;
- video/social gate results;
- every owner intervention;
- rollback/operations runbook;
- recommendation: `GRADUATE`, `EXTEND_DOGFOOD`, or `REJECT`.

Self-service remains disabled until explicit owner approval.

## 5. Critical Flow Review

### Happy path

Valid manifest and exact-context preflight produce a preview. Owner confirms kickoff. Workers receive adapter-owned envelopes and return valid evidence. Three owner gates advance the run. Kanban mirrors state. Publishing requires exact-SHA approval.

### Nil or missing-input path

Missing episode, manifest, profile, dependency, SHA, owner identity, quality profile, or output root fails before dispatch. No native card is created.

### Empty or no-op path

Repeated prepare/status/kickoff/gate commands return the canonical result. Empty worker evidence blocks downstream tasks. A run with no ready tasks reports its exact wait or terminal state.

### Error path

Timeout triggers idempotency lookup, not immediate retry. Invalid evidence is quarantined. Recoverable stale work resumes once. Tool defects require staged repair. Ambiguous publish responses are never recorded as success.

## 6. Architecture Review Notes

### Data flow

Telegram input becomes a validated episode ID, then immutable manifest, then canonical run. Controller envelopes flow to native cards. Structured evidence returns to the ledger. Monitor/projector consume normalized state. Publishing consumes only an approved immutable packet.

### State transition risks

- Split ownership can produce duplicate transitions; normalized state and idempotency prevent this.
- Timeout after card creation is the highest duplicate risk; lookup-before-retry is mandatory.
- Historical ledgers use older schemas; new fields are additive and missing fields conservative.

### Dependency risks

- Plugin release pins exact agent/adapter versions.
- Router invokes active staged controller, not a stale global binary.
- Monitor/projector use the same project path and active release as HerOrches.

### Performance risks

- Preflight performs one bounded check per role/tool and caches identical checks.
- Projector reads registry-referenced ledgers, not every artifact.
- Monitor notifications are transition-deduplicated.

### Observability

One status packet must answer: episode/revision, run status, active task/attempt, gate, heartbeat age, blocker class, next action, manifest SHA, and active toolchain versions.

## 7. Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | SDTK-AGENT ledger remains canonical. | Yes | High |
| A2 | Native Hermes Kanban remains worker transport. | Yes | High |
| A3 | Dispatcher home is `/opt/data/hermes`, profiles under `/opt/data/hermes-profiles`. | Yes, current builder/tests | High |
| A4 | EP3 canonical content is Second Brain. | Yes, owner-approved EP3 work | High |
| A5 | EP4 can be finalized as manifest data without controller changes. | No | Medium |
| A6 | Current HerOrches Telegram owner/home-channel configuration remains valid. | Partially | Medium |
| A7 | `sdtk-marketing-kit@0.19.0` contains required evidence-bound gates. | Partially | Medium |
| A8 | Package publication remains owner-attended. | Yes | Low |
| A9 | External publication remains attended and exact-SHA-gated. | Yes | High |
| A10 | Historical blocked runs are retained. | Yes | Low |

## 8. Open Questions

No question blocks Tasks 0-11. Before EP4 dogfood, owner must lock EP4 story/product proof/CTA. Package versions are assigned during release preparation; this plan does not guess them.

## 9. Not In Scope

- Free-form Telegram workflow generation.
- Automatic approval or unattended publishing.
- Deleting/rewriting historical ledgers.
- General-purpose non-video orchestration.
- Replacing Hermes Kanban or SDTK-AGENT.
- Reclassifying failed historical episodes as successful.

## 10. Verification Checklist

- [ ] Clean isolated worktrees created from current `origin/main`.
- [ ] EP2-EP4 manifests validate and hash deterministically.
- [ ] EP3 resolves to Second Brain.
- [ ] Controller, monitor, and projector share state fixtures.
- [ ] Adapter owns identity, dependency hashes, attempt, and idempotency.
- [ ] Retry increments before dispatch and preserves prior evidence.
- [ ] Exact-context preflight has zero side effects on failure.
- [ ] Router accepts only exact owner/channel grammar.
- [ ] Privacy fixtures fail closed and clean demo fixtures pass.
- [ ] Agent/adapter package tests and dry-run packs pass.
- [ ] Plugin/router tests pass.
- [ ] Staging release and rollback pointer are verified.
- [ ] Disposable E2E completes with zero publish calls/duplicates.
- [ ] EP2, EP3, and EP4 final attempts complete without mid-run changes.
- [ ] Graduation packet records defects, interventions, hashes, and parity.
- [ ] Owner explicitly approves or rejects graduation.

## 11. Approval Gate

No implementation begins until the owner approves this plan.

Required approval:

```text
APPROVE TELEGRAM VIDEO SELF_SERVICE IMPLEMENTATION PLAN R1
```

