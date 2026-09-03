# SDTK Telegram Marketing Three-Workflow Master Plan R1

Date: 2026-09-03
Status: PROPOSED - OWNER REVIEW REQUIRED
Supersedes workflow shape only: `SDTK_TELEGRAM_VIDEO_SELF_SERVICE_MASTER_PLAN_R1_20260901.md`
Preserves: attended approvals, evidence boundaries, SHA-pinned artifacts, no unattended publishing

## 1. Objective

Replace the monolithic Telegram marketing-video run with three independent, durable workflows connected only by immutable, validated artifacts:

```text
Workflow A - RESEARCH_AND_STORY       owner: HerResearch
  -> production-brief.json + approval packet

Workflow B - VIDEO_PRODUCTION         owner: HerVid
  -> video master + evidence manifest + approval packet

Workflow C - SOCIAL_DISTRIBUTION      owner: HerSocial
  -> platform payloads + publish packets + publish receipts
```

HerOrches is the Telegram command router and deterministic workflow broker. It is not a content worker and must not author story, capture media, render video, or publish.

The three workflows can fail, retry, or be rerun independently. A failure in social publishing must never rewrite the accepted video state. A script revision creates a new brief revision; it does not mutate an existing video run.

## 2. Why The Workflow Is Split

The current 13-stage run combines research, knowledge retrieval, script synthesis, capture, render, social preparation, publishing approval, and lesson recording. It has too many adapter boundaries and lets one malformed result block unrelated downstream capabilities.

The new design has one accountable worker per workflow and one canonical output contract per handoff:

| Boundary | Old behavior | New behavior |
| --- | --- | --- |
| Research to production | Multiple task results and model-authored evidence | One validated, owner-approved production brief |
| Capture to render | HerDev-to-HerVid external handoff | HerVid owns capture and render in one workflow |
| Video to social | Same run remains open through publishing | Picture-locked video is an immutable input to a separate social run |
| Lessons | Blocks final completion | Asynchronous post-publication improvement workflow, outside the critical path |

## 3. Bot Ownership

### 3.1 HerResearch

HerResearch owns Workflow A end to end:

- bounded public research;
- pain-point and audience evidence;
- optional read-only retrieval of accepted SDTK lessons;
- story options;
- claim ledger;
- English narration and caption script;
- shot list and required product evidence;
- CTA proposal;
- final production brief package.

HerResearch may call deterministic read-only tools such as `sdtk-wiki search`, but it must not dispatch HerWiki as a required child worker. Missing lessons produce an explicit `unknown` and do not block research.

### 3.2 HerVid

HerVid owns Workflow B end to end:

- production-brief validation;
- capture preflight;
- real product capture;
- capture manifest and privacy checks;
- voice, captions, music, and assembly;
- preview render;
- automated video-quality gates;
- correction attempts allowed by policy;
- final render and picture-lock packet.

Combining capture and render removes the fragile HerDev-to-HerVid handoff. HerVid may invoke deterministic capture scripts and SDTK-Marketing helpers, but may not fabricate product behavior or alter the approved story.

### 3.3 HerSocial

HerSocial owns Workflow C end to end:

- validate the accepted brief and picture-locked video hashes;
- generate English YouTube, Facebook, and X payloads;
- run claim, hook, length, URL, and platform checks;
- create immutable publish packets;
- wait for exact owner approval per platform;
- publish through idempotent platform adapters;
- verify canonical permalink and platform object ID;
- record publish receipts.

An ambiguous publish response must enter `verification_required`; it must not retry an upload automatically.

### 3.4 HerOrches

HerOrches owns no creative workflow. It provides:

- exact Telegram command parsing;
- manifest resolution;
- preflight invocation;
- run creation and status queries;
- gate-signal forwarding;
- cancellation forwarding;
- material state-change notifications.

All lifecycle mutations are executed by deterministic controller code.

## 4. HerDev Decision

HerDev is removed from the normal episode execution path.

### Use HerDev only when

- a capture CLI or browser harness is broken;
- a product fixture must be implemented or repaired;
- the Remotion/HyperFrames composition framework needs a code change;
- a quality gate or evidence validator needs implementation;
- a platform adapter has a reproducible software defect.

### Do not use HerDev for

- routine product capture;
- choosing shots;
- assembling an episode;
- correcting content that HerVid can fix with existing tools;
- writing canonical task metadata.

HerDev work is a separate engineering defect lane with its own review and deployment. A production run encountering `TOOL_DEFECT` stops and references the defect; it does not hot-patch itself. After the fix passes staging E2E, the affected workflow starts a new attempt pinned to the new release.

## 5. Shared Artifact Protocol

Every handoff is a directory containing a typed manifest and immutable files. The controller, not the model, calculates identity and SHA-256 values.

```text
marketing-runs/<episode>/<revision>/
  research/
    production-brief.json
    production-brief.md
    claim-ledger.json
    sources.json
    story-lock-packet.json
  video/
    capture-manifest.json
    quality-report.json
    video-master.mp4
    review-frames/
    picture-lock-packet.json
  social/
    youtube.json
    facebook.json
    x.json
    publish-packets/
    publish-receipts/
```

Required common fields:

```json
{
  "schema_version": "sdtk.marketing-handoff.v1",
  "episode_id": "EP4",
  "revision": "r1",
  "workflow": "research_and_story",
  "release_id": "...",
  "inputs": [{"path": "...", "sha256": "..."}],
  "outputs": [{"path": "...", "sha256": "...", "media_type": "..."}],
  "validation_status": "pass",
  "created_at": "..."
}
```

Models write candidate content files only. A deterministic finalize helper validates schemas, path containment, file presence, privacy rules, and hashes before committing the workflow completion event.

## 6. Workflow A - Research And Story

### 6.1 Telegram surface

```text
/marketing-research prepare EP4
APPROVE RESEARCH KICKOFF <run_id> <episode_manifest_sha256>
/marketing-research status <run_id>
APPROVE STORY LOCK <run_id> <brief_sha256>
REJECT STORY LOCK <run_id> <reason_code>
CANCEL RESEARCH RUN <run_id>
```

### 6.2 State flow

```text
prepared
-> awaiting_kickoff
-> researching
-> drafting_story
-> validating_brief
-> awaiting_story_lock
-> completed
```

Terminal alternatives: `failed`, `blocked`, `cancelled`, `rejected`.

### 6.3 Input

- allowlisted episode seed: product, target audience, pain point, language, CTA boundary;
- bounded source policy;
- accepted lesson index, when available;
- model policy and token budget.

### 6.4 Output

`production-brief.json` must contain:

- audience and pain point;
- one primary promise;
- supported claims and forbidden claims;
- cited public evidence;
- story arc;
- English voiceover script;
- caption script;
- shot list;
- exact product behaviors that must be captured;
- CTA;
- target duration and formats;
- video quality profile;
- unresolved unknowns.

### 6.5 Gates

1. Source and claim validation.
2. `sdtk-marketing check --strict` for narration/captions.
3. Deterministic brief schema validation.
4. Owner Story Lock by exact brief SHA.

HerResearch does not capture or render media.

## 7. Workflow B - Video Production

### 7.1 Telegram surface

```text
/marketing-video prepare <brief_sha256>
APPROVE VIDEO KICKOFF <run_id> <brief_sha256>
/marketing-video status <run_id>
APPROVE ASSET LOCK <run_id> <capture_manifest_sha256>
APPROVE PICTURE LOCK <run_id> <video_sha256>
REJECT VIDEO GATE <run_id> <gate_id> <reason_code>
CANCEL VIDEO RUN <run_id>
```

Asset Lock may be configured as mandatory during dogfood and optional only after capture reliability graduates.

### 7.2 State flow

```text
prepared
-> awaiting_kickoff
-> capture_preflight
-> capturing
-> validating_assets
-> awaiting_asset_lock
-> assembling
-> quality_checking
-> awaiting_picture_lock
-> completed
```

### 7.3 Input

- owner-approved `production-brief.json` and SHA;
- pinned capture/render toolchain release;
- model policy;
- video quality profile;
- approved brand assets.

### 7.4 Output

- reproducible capture manifest with commands, crop/viewport parameters, paths, and hashes;
- voiceover, captions, music ledger, and composition source;
- preview and final master;
- quality-gate report with real measurements;
- review frames;
- picture-lock packet.

### 7.5 Gates

1. Exact execution-context preflight.
2. Real-capture and privacy validation.
3. Optional owner Asset Lock during dogfood.
4. Audio, subtitle, content, layout, motion, and encode gates.
5. Full-duration human viewing declaration by HerVid.
6. Owner Picture Lock by exact video SHA.

HerVid gets a bounded correction budget. A content correction creates a new render attempt. A tooling defect stops the workflow and opens a HerDev defect lane.

## 8. Workflow C - Social Distribution

### 8.1 Telegram surface

```text
/marketing-social prepare <brief_sha256> <video_sha256>
APPROVE SOCIAL KICKOFF <run_id> <input_packet_sha256>
/marketing-social status <run_id>
APPROVE SOCIAL POST <run_id> <platform> <packet_sha256>
REJECT SOCIAL POST <run_id> <platform> <reason_code>
CANCEL SOCIAL RUN <run_id>
```

### 8.2 State flow

```text
prepared
-> awaiting_kickoff
-> generating_payloads
-> validating_payloads
-> awaiting_platform_approvals
-> publishing_platform
-> verifying_permalink
-> completed
```

Each platform has its own substate. YouTube success cannot imply Facebook or X success.

### 8.3 Input

- Story-Locked brief and SHA;
- Picture-Locked video and SHA;
- platform account policy;
- schedule and privacy setting;
- publishing feature flags.

### 8.4 Output

- checked platform-native payloads;
- exact-SHA approval packets;
- platform object IDs and canonical permalinks;
- duplicate-detection keys;
- publish or verification receipts.

### 8.5 Gates

1. Input hash and owner-lock validation.
2. Hook, claim, URL, character-count, and platform-format checks.
3. Separate owner approval for every platform.
4. Idempotency check before upload.
5. Permalink verification after upload.

No platform publishes automatically from Workflow B.

## 9. Post-Publication Lessons

Measurement and lesson extraction are not part of the three critical workflows. They run asynchronously after publication:

```text
measurement job
-> candidate lesson package
-> owner review
-> HerWiki acceptance
```

Failure here must not change Research, Video, or Social completion status.

## 10. Canonical State And Notifications

All three workflows use the same durable primitives:

- command inbox with Telegram update ID and idempotency key;
- append-only workflow events;
- deterministic state reducer;
- task lease, heartbeat, deadline, and attempt;
- one controller-owned retry policy;
- transactional notification outbox;
- read-only SDTK-WIKI Kanban projection.

HerOrches sends notifications only for material transitions: accepted, started, completed, waiting for owner, retry scheduled, blocked, cancelled, and completed. Telegram and Kanban consume the same event revision.

## 11. Failure And Recovery Rules

| Failure class | Action |
| --- | --- |
| `CONTENT_DEFECT` | Return bounded correction to the owning bot within attempt policy |
| `RECOVERABLE_WORKER` | Controller retries once from checkpoint |
| `RECOVERABLE_RUNTIME` | Resume the same leased task after health verification |
| `TOOL_DEFECT` | Stop workflow; open separate HerDev engineering lane |
| `OWNER_GATE` | Wait durably; no timeout-based approval |
| `EXTERNAL_BLOCKER` | Stop and report required external action |
| ambiguous publish result | Verify by idempotency key/platform ID; never upload again blindly |

No worker, router, projector, or notifier owns retry.

## 12. Implementation Plan

### Task 1 - Shared durable workflow kernel

Purpose: implement command inbox, append-only events, reducer, leases, heartbeat, attempts, and transactional outbox.

Likely modules:

- `control-plane/marketing-workflows/`
- controller state/storage helpers;
- common schemas and tests.

Verification:

- replay yields byte-equivalent state;
- duplicate Telegram update produces no duplicate run or task;
- restart during task preserves lease and next action;
- notification and projection use the committed event revision.

Containment: feature flags remain off; existing controller remains unchanged during development.

### Task 2 - Typed artifact/result protocol

Purpose: prevent model-authored metadata from mutating workflow state.

Likely modules:

- shared JSON schemas;
- deterministic finalize CLI/helper;
- adapter result ingestion.

Verification:

- historical malformed EP2 evidence fixtures fail deterministically;
- valid fixtures calculate hashes and complete once;
- path escape, missing file, stale input hash, and identity mismatch fail closed.

Containment: retain invalid artifacts in quarantine; never delete source evidence.

### Task 3 - Workflow A implementation

Purpose: allow HerResearch to produce one Story-Locked production brief.

Verification:

- happy path reaches Story Lock;
- missing public evidence records unknown without invented claims;
- empty source set blocks before model dispatch;
- reject creates a new brief revision, not an in-place mutation;
- completion does not create capture/render tasks.

### Task 4 - Workflow B implementation

Purpose: allow HerVid to own capture-through-picture-lock from an approved brief.

Verification:

- stale/unapproved brief cannot start;
- capture manifest is reproducible and privacy-clean;
- quality failure cannot expose Picture Lock;
- cancel interrupts or quarantines active render safely;
- `TOOL_DEFECT` opens a reference for HerDev without hot patching the run.

### Task 5 - Workflow C implementation

Purpose: generate and publish platform payloads independently.

Verification:

- invalid video/brief hashes fail before generation;
- each platform approval is independent;
- duplicate approval/upload is idempotent;
- missing permalink enters verification, not success or automatic re-upload;
- publishing flags default off.

### Task 6 - Telegram router and notifier

Purpose: expose exact grammar and asynchronous state-change reporting.

Verification:

- owner/channel authorization;
- exact syntax and reply-context binding;
- immediate accepted response without waiting for worker completion;
- outbox retry does not repeat workflow mutation;
- bounded messages contain no secrets or raw prompts.

### Task 7 - Kanban projection

Purpose: provide one web view across independent workflow runs and artifact links.

Verification:

- event-revision parity with controller state;
- active and historical runs separated;
- no projector mutation path;
- linked brief/video/social runs are visible as a chain.

### Task 8 - Disposable production-topology E2E

Purpose: test the actual Hermes claim, execution, finalize, gate, notification, and projection path.

Verification matrix:

- happy path for A, B, and C;
- nil/missing input;
- no-op/duplicate command;
- malformed evidence;
- worker timeout and heartbeat expiry;
- restart and replay;
- approve, reject, cancel, and recovery;
- ambiguous publish response;
- pinned release mismatch.

Exit: 20 consecutive disposable runs with zero duplicate dispatch and zero state divergence.

### Task 9 - Graduated dogfood

1. Run Workflow B from an already approved brief.
2. Complete three consecutive Workflow B episodes without manual state repair.
3. Enable and dogfood Workflow A.
4. Enable and dogfood Workflow C with publishing disabled first.
5. Enable attended platform publishing only after dry-run receipts pass.

No package publish, source patch, or hot deployment is permitted during a graduation run.

## 13. Dependency Order

```text
Task 1 -> Task 2
Task 2 -> Task 3, Task 4, Task 5
Task 1 -> Task 6, Task 7
Tasks 3-7 -> Task 8
Task 8 -> Task 9
```

Workflow B should graduate first because it is the smallest workflow that proves the core business outcome: an approved brief becomes a reviewable video.

## 14. Observability

### Owner sees

- one run ID per workflow;
- current stage, attempt, heartbeat age, and next action;
- exact approval packet and artifact SHA;
- linked upstream/downstream workflow IDs;
- canonical output or precise blocker.

### Operator sees

- command dedupe result;
- event revision;
- worker lease and heartbeat;
- retry owner and attempt;
- result-validator output;
- outbox delivery state;
- Kanban parity status.

### Storage

- commands, events, leases, artifacts, gates, and outbox entries are append-only or compare-and-swap protected;
- current state is derived;
- files are never deleted automatically during failure recovery.

### Logs

- include workflow, run, task, attempt, transition, duration, and classification;
- exclude secrets, raw model context, credentials, and private Telegram payloads.

## 15. Assumptions

| # | Assumption | Verified | Risk if wrong |
| --- | --- | --- | --- |
| A1 | HerVid can invoke all existing deterministic capture tools used by EP1-EP3 | Partially | High - Workflow B would need a bounded capture executor service |
| A2 | HerResearch can call read-only public research and local accepted-lesson search without HerWiki dispatch | Partially | Medium - missing retrieval adapter would reduce story quality, not workflow correctness |
| A3 | HerSocial platform credentials and attended publishers remain separately configured | Yes from prior lane evidence | High - Workflow C must remain preparation-only where unavailable |
| A4 | SQLite is acceptable for the first durable controller deployment on the current single-host control plane | Not yet owner-approved | Medium - another store may be required for multi-host operation |
| A5 | Existing SDTK-AGENT ledger can be retained as a compatibility projection during migration | Not yet verified | Medium - migration may require a dual-read transition |
| A6 | Asset Lock remains mandatory during initial dogfood | Proposed | Low - removing it early increases quality risk |

## 16. Open Questions For Implementation Design

These questions do not change the three-workflow product shape, but must be resolved before coding the kernel:

1. Storage choice: local SQLite event store for the current single-host deployment, or an existing durable database?
2. Compatibility: should existing `/marketing-video prepare EP2` remain as a deprecated alias or be disabled once Workflow B ships?
3. Asset Lock graduation: retain permanently or make optional after three clean video runs?
4. Social scheduling: publish immediately after approval or support an owner-selected schedule in the first Workflow C release?

Recommended defaults: SQLite, retain the old command as a warning-only alias for one release, keep Asset Lock through graduation, and defer scheduling until publishing idempotency is proven.

## 17. Not In Scope

- arbitrary natural-language workflow construction;
- HerOrches authoring creative artifacts;
- automatic owner approval;
- unattended social publishing;
- mandatory HerWiki/HerDev participation in every episode;
- automatic deletion of failed runs or artifacts;
- Temporal migration before the typed artifact protocol is stable;
- hot patching an active production run.

## 18. Approval Gate

No implementation begins until the owner approves this plan and the recommended defaults in Section 16.

Exact approval phrase:

```text
APPROVE SDTK MARKETING THREE_WORKFLOW MASTER PLAN R1
```
