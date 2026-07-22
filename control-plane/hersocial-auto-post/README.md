# HerSocial Facebook Auto-Post Runner

Deterministic Facebook Page scheduling for owner-approved SDTK posts. The runner has no LLM in the publication path and is disabled by default.

## Safety Contract

- Secrets are loaded only from mounted profile/marketing env files and passed through `env -i`.
- `mkt-digest.env` must remain mode `0600`.
- A manifest must be `approved`, name `owner` as approver, and contain the exact SHA-256 of its canonical content.
- Missing media, unsupported video, stale schedule, approval drift, invalid timezone, or Graph health failure blocks publication.
- The runner does not retry Facebook publication automatically.
- Exact existing Page content is adopted instead of duplicated.
- Personal-profile sharing and video publishing are out of scope.

## Manifest Approval Flow

1. Marketing updates the canonical post and asset contract.
2. Operator creates the matching JSON manifest under `posts/`.
3. Preview while the service remains disabled:

```bash
HERSOCIAL_AUTO_POST_ENABLED=false \
  /workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/start-hersocial-auto-post.sh \
  --preview <post-key>
```

4. Owner approves the exact command returned by preview:

```text
APPROVE HERSOCIAL POST <post-key> <content_sha256>
```

5. Set the digest in `approval.approved_content_sha256`, verify preview again, then enable the supervisor program only for the approved schedule.

## Enable And Roll Back

Enable by changing only the program environment to `HERSOCIAL_AUTO_POST_ENABLED="true"`, then run `supervisorctl reread`, `supervisorctl update`, and restart the program.

Rollback is non-destructive:

1. Set `HERSOCIAL_AUTO_POST_ENABLED="false"`.
2. Reload/restart the program.
3. Preserve state and logs for audit; never delete or modify published posts automatically.

## Runtime State

- State: `/opt/data/hermes/control-plane/hersocial-auto-post/state.json` (`0600`)
- Log: `/opt/data/hermes/control-plane/hersocial-auto-post/supervisord.log`
- Program: `hermes-hersocial-auto-post`
