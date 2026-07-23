# HerSocial Marketing Automation

`hermes-hersocial-marketing-automation` measures the `distribution-r2` campaign every Monday at
08:00 Asia/Ho_Chi_Minh. It sends the deterministic stdout of `digest`, `attribution pull`, `eval`,
and `report` to the owner Telegram chat. It never invokes a posting adapter.

- Ledger: `/opt/data/hermes/control-plane/marketing` (`0700`).
- State/logs: `/opt/data/hermes/control-plane/hersocial-marketing-automation`.
- Secrets: mounted env files only. `mkt-digest.env` must remain `0600`.
- Manual verification: run the wrapper with `--run-once`.

Posting remains separately gated: `HERSOCIAL_AUTO_POST_ENABLED=false` and an exact owner approval
is still required for every post.
