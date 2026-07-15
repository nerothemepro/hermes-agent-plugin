# UC-1 Nightly Repo/Release Watch

The UC-1 runner sends one deterministic, read-only digest each day at **09:00 Asia/Tokyo (= 07:00 Asia/Ho_Chi_Minh per packet)**.

It uses the validated Phase B Telegram notifier route: the existing HerOrches bot and owner chat. The runner sends `scripts/ops/nightly_watch.py` stdout exactly as emitted. It does not involve an LLM, create a Kanban task, or mutate SDTK/Hermes state outside its dedicated mirror clone and local delivery state.

## Persistent Inputs

- Mirror: `/opt/data/hermes/control-plane/mirrors/sdtk-internal`
- State/logs: `/opt/data/hermes/control-plane/nightly-watch/`
- GitHub secret file: `/opt/data/hermes/control-plane/secrets/uc1-nightly-watch.env`
- Supervisor program: `hermes-uc1-nightly-watch`

The secret file must contain only `UC1_GITHUB_TOKEN=<fine-grained-read-only-token>` and have mode `0600`. It is not a repository file and must never be copied into evidence, logs, or chat.

## Missed-Run Policy

On service start, if the local Tokyo fire time has passed and no successful delivery has occurred for more than 24 hours, the service runs exactly once immediately. `last_scheduled_attempt_local_date` prevents a restart from double-sending on the same Tokyo date.

## Operator Commands

Change schedule: update `SCHEDULE_HOUR` in `nightly_watch_runner.py`, update `SCHEDULE_LABEL`, run tests, then restart the supervisor program.

Rotate token: replace only the `UC1_GITHUB_TOKEN` value in the secret file, retain mode `0600`, then restart `hermes-uc1-nightly-watch`. Do not print the token.

Re-point mirror: stop the supervisor program, archive or remove only the dedicated mirror path, update `MIRROR_REPOSITORY` if needed, then start the program. The next run reclones it.

Rollback: `supervisorctl stop hermes-uc1-nightly-watch`, remove its include from `supervisord.conf`, and restart supervisord. This does not affect the Phase B monitor, HerOrches gateway, router, or any attended workflow.
