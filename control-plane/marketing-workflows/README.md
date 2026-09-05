# Marketing Three-Workflow Control Plane

Status: staging-only Workflow B adapter is implemented; production routing remains disabled.

This module separates marketing automation into three durable workflows:

- `research_and_story` owned by HerResearch;
- `video_production` owned by HerVid;
- `social_distribution` owned by HerSocial.

`kernel.js` owns append-only events, command idempotency, leases, heartbeats, and the notification outbox. `controller.js` enforces workflow ordering and SHA-pinned owner gates. `result-contract.js` validates worker artifacts before state mutation. `native-kanban-adapter.js` creates an idempotent blocked native HerVid card, commits its mapping, then releases it. `worker-result-bridge.js` accepts only a mapped native card and a valid candidate envelope. `command-parser.js` accepts exact Telegram grammar only. `notifier.js` and `projector.js` consume committed events and never own workflow mutations.

Do not connect this module to the production Telegram router until the CLI boundary and disposable production-topology E2E pass. Existing self-service commands remain unchanged until that graduation gate.

## CLI Boundary (staging only)

`bin/hermes-marketing-workflow` is the only command surface intended for a future Telegram router integration. It accepts a bounded `telegram` invocation, persists command idempotency and events in SQLite, and returns JSON only.

```text
hermes-marketing-workflow telegram \
  --database-file <absolute-state.sqlite> \
  --artifact-root <canonical-artifact-root> \
  --command-id telegram:<update-id> \
  --text '/marketing-research prepare EP4'
```

- A `prepare` command deterministically derives its run ID from the Telegram command ID. Retrying the same update returns the existing run rather than creating another.
- Kickoff, gate approval, rejection, and cancellation require their exact SHA/reason grammar and use the same command inbox.
- A handoff file for video or social preparation must be JSON and be contained by `--artifact-root`; arbitrary filesystem paths are rejected.
- This CLI does not dispatch Hermes workers, call Telegram, or publish. The router/worker boundary remains disabled until disposable production-topology E2E passes.

## Workflow B Staging Boundary

`staging-entrypoint.js` is intentionally **not** a Telegram command. It supports only a fixed HerVid profile home and the dedicated `marketing-video-staging` board, and it refuses to run unless `SDTK_MARKETING_WORKFLOW_MODE=staging`.

The sequence is crash-safe at the external boundary:

1. create native card with deterministic idempotency key and initial `blocked` status;
2. persist its task mapping in the controller event stream;
3. unblock it and persist `external_released`;
4. dispatch at most one card from the dedicated staging board;
5. accept only a hash-validated candidate result from that mapped native card.

A dispatcher failure after release retains the mapping for recovery and must never create a new card. A candidate result with `status: failed` blocks both the controller run and native card; it cannot open an owner gate.

## Immutable Staging Release

The staging scripts are separate from the production router:

`staging/install-release.sh <release-id>` copies only the controller files into a new immutable release directory and writes a per-file SHA-256 manifest. `staging/verify-release.sh <absolute-release-dir>` validates that manifest. `staging/activate-release.sh <release-id>` verifies before atomically replacing the active-release pointer and preserves the previous pointer in an activation backup.

`staging/run-active.sh` accepts only `dispatch` or `submit`, sets staging mode itself, and resolves the validated active release. It is not a Telegram entrypoint. `staging/test-release-scripts.sh` is a disposable filesystem-only smoke test, including a tamper rejection check.
