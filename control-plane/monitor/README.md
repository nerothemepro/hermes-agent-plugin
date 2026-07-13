# Phase B Monitor

`hermes_control_plane_monitor.py` watches reference-only records under
`$HERMES_HOME/control-plane/runs`. SDTK ledgers remain the sole source of truth.

The monitor is outbound-only: it uses Telegram `sendMessage` and never calls
`getUpdates`, so it does not compete with the HerOrches gateway. It reuses the
HerOrches bot token through `TELEGRAM_BOT_TOKEN` and sends to the allowlisted
`TELEGRAM_HOME_CHANNEL`. Both names can be overridden with environment variables.

The only state-mutating subprocess action permitted by the monitor is:
`sdtk-agent run continue`. It never starts, dispatches, retries, cancels, archives,
or approves work. Notification deduplication state is mode `0600`; the registry and
monitor directory must be mode `0700`.

Install the unit through the deployment's supervisor, then enable it at boot. Keep
the HerOrches embedded dispatcher as the sole dispatcher owner; do not enable the
deprecated standalone Kanban daemon.
