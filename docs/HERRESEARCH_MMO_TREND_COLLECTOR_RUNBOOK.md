# HerResearch Deterministic MMO Trend Collector

## Runtime Contract

- Source: `scripts/herresearch_mmo_trend_collector.py`.
- Installed path: `<HERMES_HOME>/scripts/herresearch_mmo_trend_collector.py`.
- Hermes cron uses `--no-agent`; stdout is sent verbatim to the existing HerResearch Telegram destination.
- It runs at `0 9 * * *` in `Asia/Tokyo`.
- The collector reads `TAVILY_API_KEY` only from `<HERMES_HOME>/.env`; it never writes the value to output, logs, backups, or Git.
- Budget: at most four Tavily searches and twelve extracted URLs per run.

## Evidence Gate

`evidence_collected` requires at least eight successfully extracted URLs, five independent domains, and one publication dated in the previous 24 hours. Any shortfall returns `insufficient_evidence` without rankings, revenue claims, competition claims, or legal clearance.

The output is a source-backed evidence packet. Attended HerResearch analysis may use that packet later, but the daily job never relies on an LLM to decide whether extraction occurred.

## Install And Verify

```bash
HERMES_HOME=/opt/data/hermes-profiles/herresearch \
  /workspace/hermes-agent-plugin/scripts/install_herresearch_deterministic_daily_research.sh

HERMES_HOME=/opt/data/hermes-profiles/herresearch \
  /workspace/.venvs/hermes-agent/bin/hermes cron run 75a5ab5ba399
```

The installer prints `BACKUP_DIR`. Confirm the job lists `Mode: no-agent`, the collector script, and no attached skills.

## Rollback

```bash
cp <BACKUP_DIR>/jobs.before.json /opt/data/hermes-profiles/herresearch/cron/jobs.json
rm -f /opt/data/hermes-profiles/herresearch/scripts/herresearch_mmo_trend_collector.py
HERMES_HOME=/opt/data/hermes-profiles/herresearch \
  /workspace/.venvs/hermes-agent/bin/hermes gateway restart
```

Do not copy any `.env` file into a backup or repository.
