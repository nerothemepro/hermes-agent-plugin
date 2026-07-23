# HerResearch MMO Opportunity Radar

## Runtime Contract

- Source: `scripts/herresearch_mmo_trend_collector.py`.
- Installed path: `<HERMES_HOME>/scripts/herresearch_mmo_trend_collector.py`.
- Hermes cron uses `--no-agent`; stdout is delivered verbatim to the existing HerResearch Telegram destination.
- It runs at `0 9 * * *` in `Asia/Tokyo`.
- The collector reads `TAVILY_API_KEY` only from `<HERMES_HOME>/.env`; it never writes the value to output, logs, backups, or Git.
- Budget: at most five Tavily searches, five Google News RSS reads, three results per niche query, and fifteen extracted URLs per run. Google News RSS supplies dated discovery leads; Tavily must still extract the linked public page before it counts as evidence.

## Evidence And Ranking Contract

The radar does not treat raw source counts as a trend claim. A ranked niche requires at least two independently hosted, successfully extracted sources dated within the previous 14 days.

- `fresh_verified`: the niche has that two-domain evidence plus at least one source dated within 72 hours.
- `watchlist`: the niche has the two-domain 14-day evidence but no source dated within 72 hours. It is a research candidate, not a claim of a hot trend.
- `insufficient_evidence`: no niche reaches the two-domain gate. The brief does not fabricate a Top 5.

Each ranked item contains a buyer, monetization angle, build path using SDTK/Hermes/ComfyUI/LTX-WAN/Remotion, risk, one read-only next action, and up to two source links. The full source ledger persists as Markdown and JSON under `<HERMES_HOME>/reports/mmo-trends/`; Telegram receives the shorter Vietnamese operator brief.

Reddit app-only credentials are currently an optional coverage enhancement. Until an explicit Reddit adapter is added, the deterministic collector states that it did not query Reddit rather than implying a community signal.

## Install And Verify

```bash
HERMES_HOME=/opt/data/hermes-profiles/herresearch \
  /workspace/hermes-agent-plugin/scripts/install_herresearch_deterministic_daily_research.sh

HERMES_HOME=/opt/data/hermes-profiles/herresearch \
  /workspace/.venvs/hermes-agent/bin/hermes cron run 75a5ab5ba399
```

The installer prints `BACKUP_DIR`. Confirm the job lists `Mode: no-agent`, the collector script, and no attached skills. Review the latest JSON and Markdown evidence artifact before treating any `fresh_verified` item as an implementation candidate.

## Rollback

```bash
cp <BACKUP_DIR>/jobs.before.json /opt/data/hermes-profiles/herresearch/cron/jobs.json
cp <BACKUP_DIR>/herresearch_mmo_trend_collector.py.before \
  /opt/data/hermes-profiles/herresearch/scripts/herresearch_mmo_trend_collector.py
HERMES_HOME=/opt/data/hermes-profiles/herresearch \
  /workspace/.venvs/hermes-agent/bin/hermes gateway restart
```

Do not copy any `.env` file into a backup or repository.
