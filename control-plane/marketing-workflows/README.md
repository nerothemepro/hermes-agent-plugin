# Marketing Three-Workflow Control Plane

Status: foundation only; production routing is disabled.

This module separates marketing automation into three durable workflows:

- `research_and_story` owned by HerResearch;
- `video_production` owned by HerVid;
- `social_distribution` owned by HerSocial.

`kernel.js` owns append-only events, command idempotency, leases, heartbeats, and the notification outbox. `controller.js` enforces workflow ordering and SHA-pinned owner gates. `result-contract.js` validates worker artifacts before state mutation. `command-parser.js` accepts exact Telegram grammar only. `notifier.js` and `projector.js` consume committed events and never own workflow mutations.

Do not connect this module to the production Telegram router until the CLI boundary and disposable production-topology E2E pass. Existing self-service commands remain unchanged until that graduation gate.
