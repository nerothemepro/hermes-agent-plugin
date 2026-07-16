# BK-M1 Weekly Marketing Digest

Deterministic weekly scheduler and verbatim Telegram transport for
`scripts/ops/marketing_digest.py` from the read-only SDTK mirror.

- Schedule: Monday 08:00 Asia/Ho_Chi_Minh, equivalent to Monday 10:00 Asia/Tokyo.
- State: `/opt/data/hermes/control-plane/marketing-digest/state.json`.
- Log: `/opt/data/hermes/control-plane/marketing-digest/supervisord.log`.
- Secrets/config: `/opt/data/hermes/control-plane/secrets/mkt-digest.env` (mode `0600`).
- Manual trigger: `start-marketing-digest.sh --run-once`.

The digest subprocess receives only the documented marketing variable allowlist.
Telegram and GitHub credentials remain in the runner process and are not passed to
the digest generator. Output is delivered without LLM processing or recomposition.
