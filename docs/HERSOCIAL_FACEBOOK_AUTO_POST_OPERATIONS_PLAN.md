# HerSocial Facebook Auto-Post Operations Plan

> For implementers: execute steps in order. Do not mark any step complete until verification confirms the expected evidence.

**Goal:** Publish owner-approved SDTK Facebook Page posts on a fixed schedule and report the exact outcome to the HerSocial owner chat.

**Architecture:** A deterministic supervisord runner reads versioned post manifests, validates an owner-approved content digest, reconciles exact existing posts, and calls Facebook Graph API without an LLM in the side-effect path. Runtime state contains only references and publication results; secrets remain in mounted `0600` env files.

**Affected Systems:** `hermes-sandbox`, HerSocial Telegram notifier, SDTK Facebook Page, `hermes-agent-plugin`, Fanpage Builder media artifacts.

**Rollback Strategy:** Disable the supervisor program or set `HERSOCIAL_AUTO_POST_ENABLED=false`; archived state and already-published Facebook posts are never deleted automatically.

**Risk Level:** HIGH

---

## Scope

1. Add a manifest validator and deterministic schedule runner.
2. Add exact-message reconciliation and one-attempt Graph API publication.
3. Add first-comment publication and owner Telegram reporting.
4. Add a clean-environment wrapper and supervisord program, disabled by default.
5. Prepare Post #2 only after Marketing supplies an approved asset contract and corrected copy.

## Execution Order

### Task 1: Manifest and fail-closed validation

- Add tests first for malformed manifests, unapproved content, digest drift, missing media, unsupported video, and stale schedules.
- Implement the minimum manifest loader and validator.
- Verify with targeted unit tests.

### Task 2: Idempotent Facebook publication

- Add tests first for existing-post adoption, text/image publishing, partial first-comment failure, and sanitized errors.
- Implement bounded Graph API calls with no automatic publish retry.
- Verify no duplicate is created after an uncertain result can be reconciled.

### Task 3: Scheduler state and Telegram report

- Add tests first for disabled mode, due/no-op behavior, single-attempt state, success, failure, and restart behavior.
- Persist state under `/opt/data/hermes/control-plane/hersocial-auto-post/` with mode `0600`.
- Deliver one concise deterministic report through the HerSocial bot.

### Task 4: Runtime wiring

- Add a clean-environment wrapper that maps the working marketing Page credential to the Facebook adapter variable names without printing it.
- Add a supervisord program with auto-restart and durable logs, disabled by feature flag.
- Add an operator runbook with preview, approval, enable, rollback, and incident commands.

### Task 5: Post #2 dry-run and live gate

- Import corrected Post #2 copy and the real evidence-capture asset only after Marketing updates the canonical source.
- Preview and dry-run with the exact production manifest.
- Stop and request `APPROVE HERSOCIAL POST <post_key> <content_sha256>` before enabling live publication.

## Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | The Page credential in `mkt-digest.env` remains the working read/write Page token. | Read works; write not tested | High |
| A2 | Post #2 will use a real browser-capture asset, not generated product evidence. | No | High |
| A3 | Marketing will correct the six-versus-seven palette conflict before approval. | No | Medium |
| A4 | Personal-profile sharing remains manual. | Yes | Low |
| A5 | Video publication remains out of scope for this first runner. | Yes | Medium |

## Observable State

- Customer sees: one Facebook Page post and one Vietnamese first comment.
- Operator sees: Telegram success, partial, blocked, or failed report with post key and permalink when available.
- Runtime state: content digest, attempt timestamp, Facebook post reference, comment result, and terminal status; no token values.
- Logs: event names and sanitized error classes/codes only.

## Not In Scope

- AI-generated replacement footage for real product demonstrations.
- Personal-profile sharing.
- Video upload.
- Automatic deletion, retry, rescheduling, or content rewriting.
- Publishing Post #2 before corrected copy and a real asset are present.

## Verification Checklist

- [ ] Targeted tests prove red then green.
- [ ] Full runner tests pass.
- [ ] Shell wrapper passes `bash -n` and secret-name contract tests.
- [ ] Preview produces no Facebook mutation.
- [ ] Graph health succeeds with the mapped credential.
- [ ] Post #2 manifest digest is owner-approved and unchanged.
- [ ] Exact existing-content reconciliation returns no duplicate.
- [ ] Live publication is gated on an exact owner command.
- [ ] Telegram report contains no token or partial token.
- [ ] Rollback disables future publication without deleting state.
