# EP2 Control-Plane Reliability - Implementation Plan R1

## 1. Purpose

Repair the controller-led EP2 execution path so the next non-owner task is actually claimed by its intended Hermes worker, receives a pinned evidence handoff, and is observable without routing home-group messages to an LLM.

This plan applies to the active run `run_msy31he0_50cd5d`. Its `episode_render` task is canonical `running_external`, but native Kanban card `t_cfad2e49` is `ready` with no worker run. No render, social preparation, upload, or publication has occurred.

## 2. Approved Design Boundary

Design A is implemented as five bounded changes:

1. Each board-local scheduler resolves its assignee through the canonical Hermes profile registry.
2. Dispatch preflight verifies that a task assignee can be spawned before canonical state changes to `running_external`.
3. A controller-owned immutable product-capture manifest is materialized before HerVid can render.
4. The home Telegram group accepts only deterministic control-plane syntax; all other group messages stop before the LLM gateway.
5. The Wiki projector represents normal dependency waits as `PENDING`, not an unknown blocker.

Owner gates remain Story Lock, Picture Lock, and publication approval. The controller may recover bounded runtime defects, but cannot create a new content scope, approve a gate, or publish.

## 3. Assumptions And Decisions

| ID | Assumption / decision | Evidence or handling |
|---|---|---|
| A1 | `t_cfad2e49` has never been claimed. | Native card shows `ready`, empty `runs`, and no result. Reuse/retry is auditable; never dispatch a second simultaneous render. |
| A2 | Per-profile homes are valid gateways but not a scheduler roster. | `HERMES_HOME=/opt/data/hermes-profiles/hervid` lists only `default`; its dry-run marks `t_cfad2e49` nonspawnable. |
| A3 | Hermes profile lookup is HOME-anchored, while native Kanban cards remain board-local. | `/opt/data/hermes/profiles` is the canonical registry; it is missing only the `hervid` alias. Deployment adds that exact alias after backup and never copies or deletes a profile home. |
| A4 | Product capture is DEMO DATA only. | Existing accepted capture result is limited to the synthetic fixture and must pass path/secret validation before handoff. |
| A5 | A router change may require the Hermes core fork. | Plugin changes go to `nerothemepro/hermes-agent-plugin`; any router-core code change goes in a separately reviewed `nerothemepro/hermes-agent` PR. |
| A6 | Adapter-level preflight needs a released adapter package. | Source changes live in `sdtk-internal`; package publication and runtime installation remain separately attended release/deploy steps. |

## 4. Implementation Order

### Task 1 - Record The Two Open Defects

Add, without altering the existing run ledger:

- `DEF-EP2-004` P0: HerVid is not spawnable from the configured dispatcher home.
- `DEF-EP2-005` P1: completed capture has no canonical, hash-pinned handoff manifest for HerVid.

The records must name the run, task, observed native card state, safe next action, and no-retry rule.

Verification:

```bash
node control-plane/video-dogfood/controller.js defect record ...
node control-plane/video-dogfood/controller.js inspect --run-id run_msy31he0_50cd5d
```

### Task 2 - Board-local Spawnability Contract

Keep each role's configured `HERMES_HOME`, because that home owns the native Kanban board and its card. Before live dispatch, the adapter runs the bounded, read-only command `hermes -p <profile> --version` in that board home. A missing profile fails closed before card creation or a canonical `running_external` transition.

Deployment snapshots the target and creates the one missing canonical alias:

```text
/opt/data/hermes/profiles/hervid -> /opt/data/hermes-profiles/hervid
```

It stops if that path exists with any different target. It never creates a second board, copies a full profile home, deletes an alias, or moves an existing card.

Source ownership:

- adapter preflight/tests: `sdtk-internal` `sdtk-agent-hermes-adapter`;
- controller/projector/deploy script: `nerothemepro/hermes-agent-plugin`.

Verification:

```bash
HERMES_HOME=/opt/data/hermes-profiles/hervid hermes profile list
HERMES_HOME=/opt/data/hermes-profiles/hervid hermes -p hervid --version
HERMES_HOME=/opt/data/hermes-profiles/hervid hermes kanban dispatch --dry-run --max 1 --json
node --test products/sdtk-agent/adapters/hermes/test/kanban-cli.test.js
```

Pass condition: `t_cfad2e49` is no longer reported as `skipped_nonspawnable`; an adapter unit test proves nonspawnability blocks before any external submission.
### Task 3 - Materialize The Capture Handoff

Add a controller command with fixed syntax, `handoff prepare --run-id <id> --confirm`.

It may run only when `product_capture` is completed and `episode_render` has not produced a result. It must:

1. read the completed HerDev native result and canonical evidence;
2. accept only whitelisted expected files from the known HerDev task workspace;
3. reject path traversal, symlinks escaping the workspace, non-DEMO data paths, control characters, credential patterns, and missing files;
4. copy accepted assets atomically into `<run>/artifacts/product_capture/`;
5. write `<run>/artifacts/product_capture/manifest.json` containing relative paths, byte sizes, SHA-256 values, capture command, exit code, and `data_classification: demo_only`;
6. hash the manifest and amend the *existing* render task contract to reference only the canonical manifest path and hash.

No worker scratch path, account path, token, private project identifier, or unverified file may appear in HerVid instructions.

Verification:

```bash
node control-plane/video-dogfood/controller.js handoff prepare --run-id run_msy31he0_50cd5d --confirm
node control-plane/video-dogfood/controller.js handoff deliver --run-id run_msy31he0_50cd5d --confirm
sha256sum .sdtk/agent-runtime/runs/run_msy31he0_50cd5d/artifacts/product_capture/manifest.json
node --test control-plane/video-dogfood/test-controller.js
```

Pass condition: altered source or missing source fails closed without amending the render task; valid fixture output yields a manifest whose listed hashes verify.

### Task 4 - Reconcile EP2 Without Duplicate Render

After Tasks 2 and 3 pass:

1. inspect `t_cfad2e49` under its board-local `HERMES_HOME=/opt/data/hermes-profiles/hervid`;
2. if still unclaimed, deliver the canonical handoff manifest once as a marker-comment on that exact native card;
3. if the card was claimed during repair, do not retry; inspect its native run and use that result only;
4. run one native dispatcher pass after the marker-comment is confirmed, then require evidence that the native card has a non-empty `runs` record before reporting progress.

The controller remains at the render checkpoint until native evidence proves claim/start. It must not infer success from canonical `running_external` alone.

Verification:

```bash
node control-plane/video-dogfood/controller.js inspect --run-id run_msy31he0_50cd5d
HERMES_HOME=/opt/data/hermes-profiles/hervid hermes kanban show <render-card-id> --json
```

Pass condition: exactly one active render card exists, it has one native worker run, and its render instructions name the manifest SHA. Otherwise the run is explicitly blocked with `RECOVERABLE_RUNTIME`.

### Task 5 - Fence Home-Group Telegram Ingress

Add `home_telegram_chat_env: TELEGRAM_HOME_CHANNEL` and an opt-in `exclusive_control_plane_mode: true` under the HerOrches router configuration. The former binds the exclusive fence to the existing group without embedding its identifier in source or logs.

For messages in the configured home group:

- owner exact grammar is routed deterministically;
- malformed/partial/natural-language messages are handled with the fixed syntax response (or a configured no-op response);
- non-owner messages are silently ignored;
- no unmatched message reaches an LLM, shell, skill mutator, or tool gateway.

Other chats preserve existing gateway behavior unless separately configured. The deployed default stays false until the tests and a group smoke test pass, then the deployment enables it only for the home group.

Source ownership: core router/test changes belong in `nerothemepro/hermes-agent`; plugin config/deployment/docs belong in `nerothemepro/hermes-agent-plugin`.

Verification:

```bash
pytest -q tests/gateway/test_control_plane_router.py
```

Required tests: Vietnamese natural language, malformed command, non-owner exact command, and valid exact command. Every negative case asserts `handled`, zero command-runner calls, and no fallback handoff.

### Task 6 - Correct Kanban Dependency Projection

In `control-plane/ep2-kanban/project-kanban.js`, map `waiting_for_dependency` to `PENDING` with an empty or dependency-specific neutral reason. Keep true `blocked`, `failed`, and `cancelled` as `BLOCKED`.

Verification:

```bash
node --test control-plane/ep2-kanban/test-project-kanban.js
node control-plane/ep2-kanban/project-kanban.js --project-path /workspace/hermes-agent-plugin --run-id run_msy31he0_50cd5d
```

### Task 7 - Release, Deploy, And Observe

Release sequence:

1. merge and publish the adapter only after its test suite passes;
2. merge the plugin/controller/projector PR;
3. merge the core-router PR only if Task 5 changes core code;
4. use an idempotent deployment script that snapshots every touched config/source file, validates package versions and central roster, then restarts only HerOrches;
5. reconcile the existing EP2 run through Task 4;
6. inspect the Wiki dashboard and canonical ledger after the native worker has claimed the render.

No deployment script may delete a profile, a native card, a run ledger, an artifact, or an existing backup. A failure keeps the latest backup path and stops before dispatch.

## 5. Test Matrix

| Case | Expected result |
|---|---|
| Missing `hervid` in dispatcher roster | preflight fails; no external task and no canonical active transition |
| Existing unclaimed `t_cfad2e49` after roster repair | one audited retry/amendment; no parallel card |
| Render card already claimed | inspect only; no retry |
| Capture path outside allowed worker workspace | handoff rejected; render remains blocked |
| Capture asset hash changes after manifest creation | render preflight rejects it |
| Valid DEMO capture assets | immutable manifest and hash are passed to HerVid |
| Owner natural-language Telegram message | deterministic refusal, no LLM/tool path |
| Non-owner group message | ignored |
| `waiting_for_dependency` task | Wiki Kanban shows `PENDING`, not `BLOCKED` or unknown |

## 6. Observability And Acceptance

The controller and projector must report these fields without secrets:

- canonical run/task status and attempt;
- native card ID, native status, and whether a native run exists;
- board home and profile-spawnability preflight outcome;
- manifest relative path and SHA-256;
- recovery action (`inspect`, `amend`, `retry`, or `block`);
- defect IDs and closure verification.

Acceptance is reached only when all conditions hold:

1. `episode_render` is genuinely claimed in native Hermes (`runs` non-empty).
2. HerVid receives only a canonical, hash-pinned DEMO manifest.
3. No home-group natural language can invoke the HerOrches LLM/tool loop.
4. Wiki Kanban mirrors dependency waits accurately.
5. The EP2 run remains render-only; no social or publish action occurs.

## 7. Rollback

- Each deploy creates a timestamped backup before changing runtime files.
- On preflight/test failure, restore only touched files and restart only HerOrches if it was restarted.
- Retain the canonical run, native cards, evidence, and all backup directories.
- Do not revert an already claimed native worker; reconcile it read-only and let its result determine the next state.

## 8. Out Of Scope

- New EP3 work or Telegram self-service graduation.
- Changes to SDTK product video content, model choice, media tooling, social copy, upload, or publishing.
- Auto-approval of Story Lock, Picture Lock, social, or publication actions.
- Repairing arbitrary Hermes agent behavior outside the home-group control-plane boundary.

## 9. Implementation Approval

Implementation begins only after the owner approves this plan with:

```text
APPROVE EP2 CONTROL-PLANE RELIABILITY IMPLEMENTATION PLAN R1
```
