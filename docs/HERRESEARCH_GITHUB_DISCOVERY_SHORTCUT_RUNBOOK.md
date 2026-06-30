# HerResearch GitHub Discovery Shortcut Runbook

## Purpose

Package the report-first GitHub discovery flow as a deterministic HerResearch Telegram shortcut.

Shortcut:

```text
/github-discovery
```

Owner: `herresearch`

Helper invoked:

```text
/workspace/hermes-agent-plugin/scripts/herwiki_github_discovery_report.sh
```

## Expected behavior

When the operator sends `/github-discovery`, HerResearch must:

1. run the helper above
2. read JSON stdout
3. report only these fields:
   - `status`
   - `markdown_report_path`
   - `json_report_path`
   - `raw_batch_path`
   - `top_recommendations`
   - `warnings`
   - `errors`

Do not replace this flow with free-form browser research unless the helper is blocked.

## Repo-managed profile scaffold

Use this installer to scaffold or refresh the HerResearch profile:

```bash
bash /workspace/hermes-agent-plugin/scripts/install_herresearch_profile.sh
```

This writes:

- `PROFILE.md`
- `SOUL.md`
- `config.yaml`
- `.env.example`

under:

```text
/opt/data/hermes-profiles/herresearch
```

## Live profile requirements

Required `.env` values:

```text
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USERS=...
TELEGRAM_HOME_CHANNEL=...
BROWSER_USE_API_KEY=...
```

## Verification

Start or restart the profile:

```bash
bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh herresearch || true
bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh herresearch
bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh herresearch
```

Telegram smoke test:

```text
/github-discovery
```

Expected command exposure in `/commands`:

```text
github_discovery
```

## Notes

- This is report-first only. It does not ingest into wiki automatically.
- Cron scheduling is intentionally deferred for a later phase.
- Hermes native `cronjob` support exists and should be preferred when scheduling is added later.
