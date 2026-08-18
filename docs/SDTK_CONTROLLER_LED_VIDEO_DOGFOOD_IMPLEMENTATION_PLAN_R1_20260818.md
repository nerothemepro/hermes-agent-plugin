# SDTK Controller-led Video Dogfood Mode

Implementation Plan R1
Date: 2026-08-18
Status: APPROVED - owner approval recorded 2026-08-18
Feature key: `BK399_CONTROLLER_LED_VIDEO_DOGFOOD`

## 1. Objective

Build a temporary controller-led operating mode for SDTK marketing-video production. Codex acts as the active controller, delegates bounded work to Hermes profiles, monitors the canonical SDTK-AGENT ledger and SDTK-WIKI Kanban projection, handles recoverable failures, and records toolchain defects. The owner remains the authority at three gates:

1. Story Lock
2. Picture Lock
3. Publish Approval

The mode is a dogfood bridge, not the final Telegram self-service product. After three consecutive episodes meet the graduation criteria in section 15, the proven workflow can be exposed through HerOrches and Telegram.

## 2. Current Baseline And Root Cause

The current EP2 run `run_mssff5si_c0bf25` is terminally blocked. Its research evidence was recovered, but its legacy wiki task failed and `script_package` is blocked by dependency.

Two current control-plane defects make a clean restart impossible:

1. `src/hermesControlPlanePrepare.js` treats only `completed`, `failed`, and `cancelled` as terminal. A `blocked` run is incorrectly reused by `/marketing-video ep2-usage`.
2. `control-plane/ep2-kanban/project-kanban.js` uses the same incomplete terminal set when selecting the active run, so the dashboard keeps projecting the old blocked run.

The old ledger must be retained as audit evidence. It must not be deleted, rewritten, re-readied, or presented as an active episode.

## 3. Scope Summary

This plan will:

- fix canonical terminal-state handling and deterministic run selection;
- introduce a controller-led, three-owner-gate episode workflow;
- reuse SDTK-AGENT as the only execution ledger;
- reuse native Hermes Kanban cards as worker task transport;
- reuse SDTK-WIKI Kanban as the read-only owner dashboard;
- add controller inspection, recovery classification, and checkpoint tooling;
- separate episode delivery from toolchain defect remediation;
- support staging installs from reviewed local package artifacts without publishing npm for every defect;
- project episode tasks and linked toolchain defects separately;
- dogfood EP2, EP3, and EP4 before deciding whether Telegram self-service is ready;
- retain attended, exact-SHA social publishing.

## 4. Explicitly Out Of Scope

- Autonomous owner approval.
- Automatic social publishing.
- Automatic retry loops without a bounded retry budget.
- Deleting or mutating historical run evidence.
- Replacing SDTK-AGENT with a second workflow engine.
- Making Telegram the primary controller during the dogfood period.
- Publishing npm packages after every local fix.
- General-purpose arbitrary workflow creation from Telegram text.
- Changing video generation models or redesigning the video creative stack unless an episode defect demonstrates that need.

## 5. Operating Model

```text
Owner
  |  kickoff confirmation + 3 owner gates
  v
Codex Controller
  |-- prepares and inspects the SDTK-AGENT run
  |-- dispatches only after explicit per-run owner confirmation
  |-- validates evidence and classifies failures
  |-- applies reviewed staging fixes and resumes from checkpoints
  |-- records defects and dogfood lessons
  |
  +-- HerResearch  public evidence
  +-- HerWiki      accepted prior lessons
  +-- HerOrches    script synthesis
  +-- HerDev       real product capture
  +-- HerVid       render and quality evidence
  +-- HerSocial    checked social payloads

Canonical state: .sdtk/agent-runtime/runs/<run_id>/state.json
Owner view:      SDTK-WIKI Kanban projection
External action: existing attended SHA-gated publishers only
```

There is one source of truth for workflow state: the SDTK-AGENT ledger. Controller notes, defect records, Telegram messages, and Kanban documents are references or projections and must never override it.

## 6. Gate And Workflow Contract

The controller-led episode workflow contains seven worker tasks and three owner gates:

| Order | Stage | Owner | Gate behavior |
|---|---|---|---|
| 1 | Research evidence | HerResearch | Controller validates evidence contract |
| 2 | Accepted episode lessons | HerWiki | Controller validates citations and project-local paths |
| 3 | Script package | HerOrches | Produces script, claim ledger, shots, narration, CTA |
| 4 | Story Lock | Owner | Required before capture or render |
| 5 | Product capture | HerDev | Real product evidence and SHA manifest only |
| 6 | Episode render and internal QA | HerVid + Controller | Quality failures return to the bounded fix loop |
| 7 | Picture Lock | Owner | Required after controller QA passes |
| 8 | Social package | HerSocial | YouTube, Facebook, and X payloads; no upload |
| 9 | Publish Approval | Owner | Exact payload/content SHA; external publisher remains separate |
| 10 | Lessons and final report | HerWiki + Controller | Candidate lessons recorded; no implicit acceptance |

The owner kickoff is separate from these gates. `run start` remains a safe preview and does not dispatch. Before the first `run continue --confirm`, the controller must report the task count, ready roles, dispatch count, and cost band. The expected initial contract is seven worker dispatches, three owner gates, token cost `MEDIUM`, and local render-compute cost reported separately.

## 7. Failure Policy

Each failure is classified before recovery:

| Class | Example | Controller action | Owner escalation |
|---|---|---|---|
| `WORKER_CONTENT` | Missing citation or invalid capture manifest | Return the same bounded task once | Only after two failed attempts |
| `RECOVERABLE_RUNTIME` | Completed native card awaiting reconciliation | Reconcile once and verify ledger transition | No |
| `TOOL_DEFECT` | Adapter, router, monitor, or projector bug | Create defect, patch staging, test, resume checkpoint | Only if scope expands |
| `ARCHITECTURE_DEFECT` | State machine cannot express recovery safely | Stop affected slice and propose bounded design | Yes |
| `EXTERNAL_MUTATION` | Publish, account change, credential use | Stop | Always |
| `POLICY_OR_TRUTH` | Unsupported claim or fabricated evidence | Fail closed and replace evidence/content | Yes when claim decision is needed |

Retry budget:

- Attempt 1: assigned Hermes worker.
- Attempt 2: same worker with a precise correction based on evidence.
- After attempt 2: controller performs the bounded task or marks it blocked; no infinite loop.
- A code defect does not consume a worker retry.
- No recovery may create a duplicate external task or duplicate social upload.

## 8. Staging And Release Boundary

Episode execution must not depend on an npm release for every fix.

The staging toolchain will use immutable local release directories under a persistent control-plane path. Each release contains reviewed package tarballs or source snapshots plus a manifest of package versions and SHA-256 values. Runtime wrappers select one explicit active release. Rollback selects the previous manifest and restarts only the affected supervised process.

Required properties:

- no secret or token in the release manifest;
- no global npm overwrite as the primary dogfood path;
- no source deletion during activation or rollback;
- current and previous release retained;
- `PATH` and `NODE_PATH` pin the active SDTK-AGENT and Hermes adapter versions;
- activation is observable in logs without printing environment values;
- npm publication happens only after episode closure and regression review.

## 9. Implementation Tasks

### Task 1 - Centralize Terminal Run Semantics

Purpose:

- Treat `blocked` as terminal everywhere run reuse or active-run selection is decided.
- Prevent a terminal EP2 ledger from being reused by a new prepare request.

Likely files:

- `src/hermesControlPlanePrepare.js`
- `test/hermesControlPlanePrepare.test.js`
- `control-plane/ep2-kanban/project-kanban.js`
- a new projector test file under `control-plane/ep2-kanban/`

Required behavior:

- terminal: `completed`, `failed`, `blocked`, `cancelled`;
- nonterminal: `created`, `running`, `waiting_for_approval` and documented external-active states;
- malformed, missing, or path-mismatched records are never reused;
- newest nonterminal matching run is selected deterministically;
- when no nonterminal run exists, prepare creates a fresh run and registry record.

Verification:

```bash
node --test test/hermesControlPlanePrepare.test.js
node --test control-plane/ep2-kanban/test-project-kanban.js
```

Containment/rollback:

- Restore the prior prepare/projector files from backup.
- Historical ledgers and registry records remain untouched.

### Task 2 - Replace EP2-only Workflow With A Manifest-backed Episode Builder

Purpose:

- Reuse one reviewed workflow shape for EP2, EP3, and EP4 without accepting arbitrary Telegram prompts.
- Reduce the workflow to the approved three owner gates.

Likely files:

- `src/hermesControlPlaneEp2.js`, renamed or wrapped by a series-oriented builder
- `control-plane/templates/marketing_video_ep_usage/template.json`
- `control-plane/ep2-kanban/marketing-video-series.json`
- `test/hermesControlPlane.test.js`
- `test/hermesControlPlanePrepare.test.js`

Required behavior:

- episode input resolves only through an allowlisted series manifest;
- title, pain point, evidence target, proof command, CTA, and output paths come from the manifest;
- no arbitrary task instruction is accepted from Telegram or CLI params;
- template version increments;
- owner gates are exactly Story Lock, Picture Lock, and Publish Approval;
- social task prepares payloads but cannot upload;
- lessons are candidates until reviewed during episode closure;
- validation reports seven worker dispatches, three gates, no retry loop.

Verification:

```bash
node bin/hermes-control-plane validate --template marketing_video_ep_usage
node --test test/hermesControlPlane.test.js test/hermesControlPlanePrepare.test.js
sdtk-agent workflow validate --file <rendered-workflow.json> --json
```

Containment/rollback:

- Keep the R2 template readable for audit.
- Switch the active template manifest back without altering existing runs.

### Task 3 - Add A Controller Inspection And Checkpoint Surface

Purpose:

- Give the Codex controller one deterministic command surface for inspection and bounded recovery.
- Avoid long ad hoc PowerShell commands and repeated manual log reconstruction.

Proposed files:

- `control-plane/video-dogfood/controller.js`
- `control-plane/video-dogfood/README.md`
- `control-plane/video-dogfood/test-controller.js`
- small launch scripts under `scripts/` for Windows/Docker operators

Minimum commands:

```text
inspect --run-id <id>              read-only state, external cards, heartbeat, artifacts
next --run-id <id>                 read-only recommended next action
reconcile --run-id <id>            one bounded reconcile, never dispatch
continue --run-id <id> --confirm   one explicit SDTK continue after owner kickoff
defect record ...                  add a linked local toolchain defect
defect close ...                   require verification evidence
```

The controller helper must not approve gates, publish, delete ledgers, mutate social accounts, or contain credentials. It must report when an existing command would dispatch more than one ready task.

Verification:

```bash
node --test control-plane/video-dogfood/test-controller.js
node control-plane/video-dogfood/controller.js inspect --run-id <fixture-run>
node control-plane/video-dogfood/controller.js next --run-id <fixture-run>
```

Containment/rollback:

- The helper is additive. Disable it by removing it from operator use; canonical runs remain usable through `sdtk-agent` directly.

### Task 4 - Add Episode And Toolchain-defect Projection To Kanban

Purpose:

- Show production progress and automation defects separately.
- Make blocked terminal runs visibly terminal instead of `IN_PROGRESS`.

Likely files:

- `control-plane/ep2-kanban/project-kanban.js`
- `control-plane/ep2-kanban/marketing-video-series.json`
- `control-plane/video-dogfood/defects.json`
- `control-plane/ep2-kanban/test-project-kanban.js`

Required Kanban fields:

```text
run_id, task_id, worker, attempt, status, last_heartbeat,
artifact_path, blocker_class, next_action, linked_defect
```

Required behavior:

- old blocked runs remain visible in run history but cannot become the active episode;
- active run is selected from deterministic nonterminal candidates;
- episode cards and defect cards use distinct IDs and labels;
- projector is read-only with respect to run ledgers and owner gates;
- generated Markdown remains atomic and contains no secret values;
- no-movement warnings cite the specific task and last heartbeat.

Verification:

```bash
node --test control-plane/ep2-kanban/test-project-kanban.js
node control-plane/ep2-kanban/project-kanban.js --project-path <fixture-project>
sdtk-wiki kanban --project <fixture-project> --no-open
```

Containment/rollback:

- Restore the previous projector version and regenerate Markdown from the unchanged canonical ledger.

### Task 5 - Implement Immutable Staging Toolchain Activation

Purpose:

- Test fixes on the live dogfood workflow without publishing npm after every defect.

Proposed files:

- `control-plane/video-dogfood/staging/install-release.sh`
- `control-plane/video-dogfood/staging/activate-release.sh`
- `control-plane/video-dogfood/staging/verify-release.sh`
- `control-plane/video-dogfood/staging/README.md`
- affected supervisor wrappers/configuration

Required behavior:

- backup before activation;
- install to a new immutable release directory;
- verify versions, hashes, tests, and process health before pointer switch;
- retain prior active release for rollback;
- restart only HerOrches/monitor/projector processes whose runtime changed;
- never print or copy token values;
- never delete historical releases automatically.

Verification:

```bash
bash control-plane/video-dogfood/staging/verify-release.sh <release-id>
sdtk-agent --version
node -p "require('sdtk-agent-hermes-adapter/package.json').version"
supervisorctl -c control-plane/supervisord/supervisord.conf status
```

Containment/rollback:

- Point activation back to the previous verified release.
- Restart only affected processes.
- Preserve both release directories and deployment evidence.

### Task 6 - Strengthen Monitoring Without Adding A Second Dispatcher

Purpose:

- Detect stale workers, terminal blocks, evidence mismatch, and controller attention states promptly.

Likely files:

- `control-plane/monitor/hermes_control_plane_monitor.py`
- `control-plane/monitor/test_monitor.py`
- `control-plane/monitor/README.md`

Required behavior:

- embedded HerOrches remains the only dispatch owner;
- monitor may reconcile a completed native task through the existing allowlisted continue path;
- monitor never starts, retries, approves, cancels, publishes, or creates a duplicate card;
- stale warning includes run, task, worker, last heartbeat, and classified next action;
- terminal states notify once and are never advertised as active;
- monitor exposes staging release identity and package versions without environment values.

Verification:

```bash
python3 -m unittest control-plane/monitor/test_monitor.py
python3 -m py_compile control-plane/monitor/hermes_control_plane_monitor.py
```

Containment/rollback:

- Restore the previous monitor file and restart only the monitor process.
- Dispatch ownership remains unchanged.

### Task 7 - Dogfood EP2 Under Controller-led Mode

Purpose:

- Complete Episode 2 without using Telegram as the primary control surface.
- Validate the workflow with real Hermes workers and real evidence.

Execution order:

1. Preview the rendered workflow and quote seven worker dispatches, three gates, and cost bands.
2. Wait for explicit owner kickoff confirmation.
3. Start a fresh run; verify the run id differs from `run_mssff5si_c0bf25`.
4. Dispatch HerResearch and HerWiki.
5. Inspect and validate evidence before script synthesis.
6. Reach Story Lock and obtain owner approval.
7. Produce real capture, render, and controller QA.
8. Iterate internally within the bounded failure policy.
9. Reach Picture Lock only after quality evidence and full-watch review pass.
10. Prepare social payloads and reach Publish Approval.
11. Keep publishing in the existing attended SHA-gated path.
12. Produce the final run report and defect/lesson summary.

Required evidence:

- fresh run id and template digest;
- canonical task states and Hermes task IDs;
- artifact paths and SHA-256 values;
- video quality-gate output and full-watch checklist;
- exact owner gate decisions;
- checked social payload hashes;
- no external publication without separate approval.

Containment/rollback:

- Stop at the current checkpoint and mark the run honestly blocked.
- Revert the staging release if a tool defect caused regression.
- Never revive or overwrite the old R1 run.

### Task 8 - Episode Closure And Batch Promotion

Purpose:

- Convert observed defects into tested improvements without interrupting episode delivery.

Outputs:

- episode retrospective;
- accepted and rejected lessons separated;
- defect closure evidence;
- regression tests for every promoted tool defect;
- one reviewed PR batch per affected repository;
- package version and release notes only after merge approval;
- npm publication and production deployment as separately authorized operations.

Verification:

```bash
git diff --check
node --test test/*.test.js control-plane/ep2-kanban/test-project-kanban.js control-plane/video-dogfood/test-controller.js
python3 -m unittest control-plane/monitor/test_monitor.py
npm pack --dry-run
```

Containment/rollback:

- Do not promote failed fixes.
- Keep the last verified production package versions pinned.

### Task 9 - Repeat On EP3 And EP4, Then Decide Graduation

Purpose:

- Demonstrate repeatability across three episodes before restoring Telegram-first operation.

Each episode must reuse the same controller workflow and may add only evidence-backed improvements. Architecture changes reopen design review; ordinary content corrections do not.

Verification:

- one completed canonical run per episode;
- no code patch during the final successful run attempt;
- three owner gates only;
- Kanban matches the ledger;
- attended publication remains SHA-gated;
- episode retrospective completed.

## 10. Dependency Order

```text
Task 1 terminal semantics
  -> Task 2 three-gate episode builder
     -> Task 3 controller surface
        -> Task 4 Kanban projection
           -> Task 5 staging activation
              -> Task 6 monitor hardening
                 -> Task 7 EP2 dogfood
                    -> Task 8 closure/promotion
                       -> Task 9 EP3 + EP4 graduation trial
```

Tasks 4 and 6 may be implemented in parallel only after Task 1 establishes the shared terminal-state contract. Task 7 cannot start until Tasks 1-6 pass their verification evidence and the owner explicitly confirms the run dispatch.

## 11. Critical Flow Review

### Happy Path

- Preview creates a fresh run.
- Owner confirms kickoff.
- Workers complete in dependency order.
- Controller validates evidence and corrects ordinary content issues.
- Owner approves three gates.
- Social payloads remain prepared until separate exact-SHA publication.
- Final report and lessons close the run.

### Nil Or Missing-input Path

- Missing series entry, project path, state file, task result, artifact path, or SHA fails closed.
- No fallback invents content, evidence, status, or approval.
- Controller reports the exact missing field and owner-visible next action.

### Empty Or No-op Path

- Reconcile with no eligible external completion performs no dispatch.
- Projector with no new ledger state performs zero writes.
- Repeated inspection produces no task or notification.
- Repeated publish approval remains governed by publisher idempotency and exact SHA.

### Error Path

- Worker failure is classified before retry.
- Terminal run is never reused.
- Staging failure rolls back the active release pointer.
- Monitor failure cannot become a dispatcher.
- Owner gate rejection returns only to the bounded preceding slice.
- External API or credential failure stops without automatic retry or metadata mutation.

## 12. Architecture Review Notes

### Data Flow

```text
series manifest -> workflow preview -> owner kickoff -> SDTK ledger
SDTK ledger -> Hermes adapter -> native Kanban card -> worker evidence
worker evidence -> reconcile -> SDTK ledger -> projector -> Kanban viewer
render evidence -> controller QA -> owner picture lock
social payload -> owner exact-SHA approval -> attended publisher
```

### Ownership Boundaries

- SDTK-AGENT owns workflow state transitions.
- Hermes profiles own bounded worker execution.
- Controller owns evidence review, recovery classification, and staging remediation.
- Projector owns generated Markdown only.
- Monitor owns observation and allowlisted reconciliation only.
- Owner owns Story Lock, Picture Lock, Publish Approval, and any scope expansion.
- Existing publisher owns external idempotency and publication records.

### Dependency Risks

- Multiple modules currently define terminal states independently. Task 1 must establish one tested contract before later work.
- Adapter evidence and native Kanban metadata must remain schema-aligned.
- Staging `PATH`/`NODE_PATH` drift could load mixed versions; release verification must prove resolved module paths.
- A projector that selects by timestamp alone can choose stale terminal runs; selection must filter terminal states first.

### Performance And Duplicate-work Risks

- Avoid polling every historical run on every projector tick; filter by feature and active status before detailed rendering.
- Deduplicate monitor notifications by stable run/task/status keys.
- Do not recapture or rerender when an upstream artifact hash is unchanged and the rejected finding does not affect it.
- Never resubmit a native card when a durable external ID already exists.

### Observability

For every nonterminal task, the operator must be able to see:

- canonical run and task status;
- assigned Hermes profile;
- native external task ID;
- attempt count;
- last heartbeat and deadline;
- artifact/evidence path;
- blocker class and recommended next action;
- active staging release identity.

No log, report, defect record, or Kanban output may include token values, chat identifiers, OAuth secrets, or complete environment dumps.

## 13. External Side-effect Visibility

### Customer sees

- Nothing until an owner-approved social publication occurs.
- Draft/private/unlisted states remain explicit when supported by the platform.

### Operator sees

- Run/task progress in Kanban.
- Three owner gates.
- Classified defects and next actions.
- Exact publish payload SHA and final permalink after confirmed publication.

### Persistent state

- SDTK ledger under `.sdtk/agent-runtime/runs/<run_id>/`.
- Reference-only control-plane registry record.
- Immutable staging release manifest and activation record.
- Defect records without secrets.
- Publisher record after external publication.

### Logs

- Sanitized command outcome, run/task IDs, package versions, hashes, timestamps, and error class.
- No raw secret, token, owner Telegram ID, or unbounded subprocess output.

## 14. Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | SDTK-AGENT `run start`, `run continue`, reconcile, and gate commands remain the canonical state-transition surface. | Yes | High |
| A2 | Native Hermes Kanban cards retain durable external IDs and structured metadata required by the adapter. | Yes | High |
| A3 | `blocked` is terminal for run reuse and active-run selection. | Yes, from current failure and state semantics | High |
| A4 | The owner accepts exactly three owner gates during controller-led dogfood. | Yes | High |
| A5 | Local staging packages can be selected through scoped runtime wrappers without modifying secrets. | No | High |
| A6 | Supervisor wrappers can pin `PATH` and `NODE_PATH` consistently for HerOrches, monitor, and projector. | No | High |
| A7 | Existing video quality tooling is sufficient for EP2 internal QA once invoked consistently. | Partially | Medium |
| A8 | Existing attended publishers remain the only external publication path. | Yes | High |
| A9 | EP3 and EP4 can use the same seven-task workflow shape with manifest-defined episode content. | No | Medium |
| A10 | Controller-led execution can complete within the current Hermes task deadlines. | No | Medium |

Unverified high-risk assumptions A5 and A6 must be proven with a disposable staging smoke test before Task 7. Failure reopens only Task 5 design; it does not authorize global package overwrite.

## 15. Graduation Criteria

Telegram Self-Service Mode may be proposed only after EP2, EP3, and EP4 each complete and all conditions below hold:

- no source-code patch during the final successful run attempt;
- no duplicate run, native task, video upload, or social post;
- no stale task without monitor detection and actionable classification;
- Kanban state matches the canonical ledger throughout the run;
- recovery resumes from a checkpoint without rewriting historical evidence;
- all artifacts have reproducible paths and SHA-256 values;
- video passes internal gates and owner Picture Lock;
- social payloads pass checks and owner Publish Approval;
- external publishing remains attended and exact-SHA-gated;
- owner intervention is limited to kickoff and the three approved gates;
- every accepted defect fix has regression coverage and one subsequent episode proof.

Graduation is a separate owner decision. Passing three episodes does not automatically enable Telegram dispatch.

## 16. Verification Checklist Before Implementation Handoff

- [ ] Owner approves this implementation plan.
- [ ] Task 1 has regression fixtures for `blocked`, `failed`, `cancelled`, `completed`, `running`, and `waiting_for_approval`.
- [ ] New prepare returns a new run ID when all prior matching runs are terminal.
- [ ] Projector never chooses a terminal run when a nonterminal run exists.
- [ ] Three-gate workflow validates with seven worker dispatches and no retry loop.
- [ ] Controller helper cannot approve, publish, delete, or expose credentials.
- [ ] Defect projection is separate from episode task state.
- [ ] Staging release activation and rollback are proven without npm publication.
- [ ] Monitor remains non-dispatching except its existing allowlisted reconcile/continue behavior.
- [ ] EP2 preview is shown to the owner before any dispatch.
- [ ] Owner explicitly confirms the first EP2 controller-led dispatch.
- [ ] Final successful EP2 run has a new run ID and does not reuse `run_mssff5si_c0bf25`.

## 17. Approval And Next Step

No implementation begins from this document alone.

Required owner decision:

```text
APPROVE BK399 CONTROLLER_LED_VIDEO_DOGFOOD IMPLEMENTATION PLAN R1
```

After approval, execute Tasks 1-6 sequentially with task-level verification. Stop before Task 7, report the validated workflow preview and dispatch count, and request the explicit owner kickoff confirmation required by the SDTK orchestration cost gate.
