# Marketing Three-Workflow Control Plane

Status: foundation only; production routing is disabled.

This module separates marketing automation into three durable workflows:

- `research_and_story` owned by HerResearch;
- `video_production` owned by HerVid;
- `social_distribution` owned by HerSocial.

`kernel.js` owns append-only events, command idempotency, leases, heartbeats, and the notification outbox. `controller.js` enforces workflow ordering and SHA-pinned owner gates. `result-contract.js` validates worker artifacts before state mutation. `command-parser.js` accepts exact Telegram grammar only. `notifier.js` and `projector.js` consume committed events and never own workflow mutations.

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
