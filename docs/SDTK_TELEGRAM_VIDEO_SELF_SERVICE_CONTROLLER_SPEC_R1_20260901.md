# SDTK Telegram Video Self-Service Controller Spec R1

Date: 2026-09-01  
Status: APPROVED  
Related master plan: `SDTK_TELEGRAM_VIDEO_SELF_SERVICE_MASTER_PLAN_R1_20260901.md`

## 1. Design Options

### Design A - Manifest-driven controller broker (recommended)

Telegram selects an allowlisted episode. A deterministic controller resolves the versioned episode manifest, validates the exact runtime context, owns state transitions and worker envelopes, and delegates bounded tasks to Hermes profiles.

Benefits:

- Reuses existing SDTK-AGENT ledger, Hermes cards, Kanban projection, and quality tooling.
- Removes model-authored identity and dependency discovery.
- Supports repeatable episodes through data, not router patches.
- Keeps owner approval and publishing boundaries intact.

Tradeoff: requires one focused reliability implementation before another dogfood run.

### Design B - HerOrches dynamically authors workflows from Telegram

HerOrches interprets a free-form owner message and constructs tasks dynamically.

Benefits: flexible episode creation.

Risks: weak reproducibility, unbounded token/side-effect scope, difficult approval hashing, and recurrence of identity/evidence defects. Not recommended before Design A graduates.

### Design C - Codex remains the permanent controller

Owner assigns every episode to Codex; Codex invokes Hermes profiles manually.

Benefits: highest short-term recovery ability.

Risks: does not achieve Telegram self-service and cannot prove the operating model. Keep only as temporary fallback during dogfood.

## 2. System Boundaries

```text
Telegram
  -> governed Hermes router
  -> video self-service controller
  -> SDTK-AGENT canonical ledger
  -> Hermes adapter/native cards
  -> HerResearch / HerWiki / HerOrches / HerDev / HerVid / HerSocial
  -> structured evidence envelope
  -> controller reconciliation
  -> SDTK-WIKI Kanban projection

Owner gates:
  Story Lock -> Picture Lock -> Publish Approval

External publisher:
  separate attended exact-SHA path only
```

## 3. Sources Of Truth

| Data | Owner |
| --- | --- |
| Episode definition and quality profile | Versioned episode manifest |
| Workflow execution state | SDTK-AGENT ledger |
| Native task claim/run evidence | Hermes board/card store |
| Artifact paths and hashes | Adapter-owned evidence envelope |
| Defect status | Dogfood defect ledger |
| Dashboard | Read-only projector output |
| Publication authorization | Immutable social approval packet plus owner SHA approval |

## 4. Episode Manifest Contract

Each episode must resolve to one immutable manifest containing:

```json
{
  "schema_version": "sdtk.marketing-video-episode.v1",
  "episode_id": "EP3",
  "revision": "r1",
  "title": "Build a Local Second Brain for an Agent",
  "language": "en",
  "pain_point": "...",
  "story": "...",
  "product_proof": ["..."],
  "source_boundaries": ["..."],
  "cta": "https://sdtk.dev/",
  "workflow_template": "marketing_video_episode_r1",
  "quality_profile": "evidence_bound_explainer_r1",
  "toolchain": {
    "sdtk_marketing": "0.19.0",
    "sdtk_agent": "0.5.6"
  },
  "allowed_roles": ["researcher", "wiki", "orchestrator", "developer", "video", "social"]
}
```

The controller hashes the resolved manifest. Run creation, every worker envelope, gate packet, and final report records that hash. A manifest change requires a new revision and new run.

## 5. Telegram Command Contract

Exact grammar only:

```text
/marketing-video prepare EP2
/marketing-video status <run_id>
APPROVE VIDEO KICKOFF <run_id> <manifest_sha256>
APPROVE VIDEO GATE <run_id> story_lock <packet_sha256>
APPROVE VIDEO GATE <run_id> picture_lock <packet_sha256>
APPROVE VIDEO GATE <run_id> publish <packet_sha256>
REJECT VIDEO GATE <run_id> <gate_id> <reason_code>
CANCEL VIDEO RUN <run_id>
```

Rules:

- Only the configured owner ID and home channel are accepted.
- Unknown episode IDs, extra arguments, natural-language variants, stale hashes, and mismatched reply context fail closed.
- `prepare` performs resolution and preflight but dispatches nothing.
- Kickoff creates or activates exactly one run for the manifest revision.
- Status is read-only and reports canonical ledger state plus one classified next action.
- Gate approval cannot be inferred from conversational text.

The existing `/marketing-video ep2-usage` command remains a deprecated compatibility alias during migration and resolves to the same EP2 manifest.

## 6. Consolidated Preflight

Preflight must validate the exact context later used for dispatch:

1. Episode manifest schema, revision, and SHA.
2. No active nonterminal run for the same episode revision.
3. SDTK-AGENT and Hermes adapter versions match the manifest policy.
4. Each role resolves to an absolute `HERMES_HOME`, board, assignee, and spawnable profile.
5. Required CLIs, capture tools, rendering provider, LM Studio/ComfyUI dependencies, and output roots are available for relevant tasks.
6. Worker output directories are writable and evidence roots are canonical.
7. Quality profile exists and is version-pinned.
8. External publishing is disabled in the workflow.
9. Privacy fixture scan and secret-path denylist are active.

Preflight returns a bounded JSON packet and SHA. Failure creates no native card and performs no retry.

## 7. Worker Envelope Contract

The adapter, not the model, creates this envelope:

```json
{
  "run_id": "run_...",
  "task_id": "episode_render",
  "attempt": 1,
  "idempotency_key": "run_.../episode_render/1",
  "manifest_sha256": "...",
  "profile": "hervid",
  "board": "default",
  "instruction": "bounded task instruction",
  "dependencies": [
    {"task_id": "product_capture", "path": "/absolute/path/manifest.json", "sha256": "..."}
  ],
  "output_contract": {
    "root": "/absolute/canonical/root",
    "schema": "sdtk.agent-evidence.v1"
  }
}
```

Worker prose may add observations but cannot alter identity, dependencies, attempt, manifest hash, or output root. Explicit mismatch fails the task and preserves evidence.

## 8. State Model

Run states:

```text
prepared
-> awaiting_kickoff
-> running
-> waiting_for_story_lock
-> running
-> waiting_for_picture_lock
-> running
-> waiting_for_publish_approval
-> running
-> completed
```

Terminal states: `completed`, `blocked`, `failed`, `cancelled`.

Task states: `created`, `ready`, `submitted`, `running_external`, `waiting_external_evidence`, `completed`, `waiting_for_approval`, `waiting_for_dependency`, `failed`, `blocked`, `cancelled`.

Normalization rules:

- `waiting_for_dependency` is pending, never a blocker.
- One failed prerequisite blocks dependants but does not rewrite their history.
- A terminal run is never reused for a new prepare.
- Historical runs remain queryable but cannot become the active projection when a newer nonterminal run exists.

## 9. Dispatch And Idempotency

- One native card per `(run_id, task_id, attempt)`.
- Attempt increments before dispatch.
- Repeating the same controller command returns the prior card reference.
- Retry is allowed once for `RECOVERABLE_WORKER`; tool defects stop for tested repair.
- No retry may duplicate an upload, publish, approval packet, or external message.
- Dispatch timeout does not imply dispatch failure; controller inspects the card by idempotency key before deciding.

## 10. Evidence And Privacy Gates

Before completing a task, the controller validates:

- required artifact files exist under the canonical root;
- SHA-256 values match;
- result schema is valid;
- dependencies match the envelope;
- no secret/token/private Telegram ID is present;
- machine telemetry is absent unless explicitly allowlisted as labelled demo data;
- capture is real evidence or clearly labelled generated media according to the episode contract;
- render uses the selected quality profile and records factual pass/fail output.

Failed validation quarantines the artifact reference and blocks downstream handoff. It does not delete the file.

## 11. Monitor, Recovery, And Projection

The monitor reports only transitions and deduplicates by `(run_id, task_id, status, attempt)`.

Stale classification:

| Class | Controller action |
| --- | --- |
| `RECOVERABLE_WORKER` | Inspect native card, retry once from checkpoint |
| `RECOVERABLE_RUNTIME` | Verify dependency/profile health, resume existing card |
| `TOOL_DEFECT` | Stop, record defect, require tested staged fix |
| `CONTENT_DEFECT` | Return one precise correction to the same task |
| `OWNER_GATE` | Send immutable approval packet |
| `EXTERNAL_BLOCKER` | Stop and report required external change |

Kanban shows one active run, historical terminal runs, task attempts, gate packets, heartbeat age, blocker class, and next action. It never calls controller mutation commands.

## 12. Publishing Boundary

The workflow ends social preparation at an immutable packet. Publish occurs only through the existing attended publisher after exact owner SHA approval. The controller records the resulting URL and publish record but cannot synthesize approval or retry an ambiguous external response.

## 13. Observability

Every controller command returns bounded structured JSON internally and a concise Telegram summary externally. Logs include run, task, attempt, transition, elapsed time, and result class; they exclude prompt bodies, tokens, secrets, and raw model output.

Required metrics:

- prepare/preflight success rate;
- dispatch claim latency;
- stale task count and recovery result;
- duplicate prevention count;
- gate waiting duration;
- ledger/projector parity failures;
- episode completion duration;
- worker correction and tool-defect counts.

## 14. Failure Paths

- Missing manifest: fail before run creation.
- Empty worker result: task fails evidence validation; no downstream dispatch.
- Dispatch timeout: query idempotency key before retry.
- Worker profile unavailable: block with exact profile and health evidence.
- Quality gate failure: retain render as failed evidence; Picture Lock remains unavailable.
- Publish response without canonical URL/record: no publish confirmation is recorded.
- Owner cancellation: cancel pending work, reclaim active card according to adapter policy, preserve evidence.

## 15. Approval Record

Controller Design A was approved by the owner on 2026-09-01. Implementation remains separately gated by the implementation plan.

Recorded approval:

```text
APPROVE TELEGRAM VIDEO SELF_SERVICE CONTROLLER DESIGN A
```

