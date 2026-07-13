# Phase B Drain/Recreate Checklist

Operator-only procedure. Do not recreate while a live task is running.

## Before Drain

1. Record gateway/dispatcher owner and process IDs.
2. Record the `[hermes] <defunct>` baseline with `ps`.
3. Stop accepting new work. Do not create or dispatch a new card.
4. Read active work with `HERMES_HOME=/opt/data/hermes hermes kanban list --status running --json`.
5. Record ready/running cards and wait for all live tasks to become terminal.
6. Confirm no live worker remains. Never use `kill -9` for a live task.

## Host Recreate

1. Capture the container name/compose service and current mounts.
2. Recreate with `/workspace` and `/opt/data` mounted to the same host paths.
3. Ensure `control-plane/supervisord/` is available from `/workspace`.
4. Ensure the supervisor inherits the HerOrches environment without printing token values.

## After Recreate

1. Verify PID 1 is an init/reaper or supervisor, not `sleep infinity`.
2. Verify the old PID-1 zombie baseline is gone or explain any remaining entries; record counts.
3. Verify HerOrches has `dispatch_in_gateway=true`, interval `5`, and no `HERMES_KANBAN_HOME`. Confirm standalone daemon is disabled.
4. Verify supervisord owns `hermes-control-plane-monitor`, it is `RUNNING`, and its log is under `/opt/data/hermes/control-plane/monitor/`.
5. Run the Phase B preflight and the six live acceptance tests from the packet.
6. Archive only disposable validation cards and confirm active validation count is zero.

## Rollback

Stop the monitor through supervisord, restore the durable HerOrches backup if needed, and restart only the affected gateway. Do not remove the control-plane registry during rollback.
