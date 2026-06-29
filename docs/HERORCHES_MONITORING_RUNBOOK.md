# HerOrches Monitoring Runbook

## Scope

This runbook covers the HerOrches monitoring profile and the host/container scripts that support it.

## Authentication Model

HerOrches should use:

- provider: `openai-codex`, model: `gpt-5.5`

This uses the ChatGPT Plus/Pro OAuth lane supported by Hermes. It does not require a normal OpenAI API key.

Important distinction:

- supported: Hermes OAuth login for `openai-codex`
- not supported: "reuse my ChatGPT website cookie automatically without Hermes auth setup"

If remote auth is unavailable, HerOrches falls back to local LM Studio models.

## Install The Profile

Inside `hermes-sandbox`:

```bash
bash /workspace/hermes-agent-plugin/scripts/install_herorches_profile.sh
```

Or provide live Telegram values at install time:

```bash
TELEGRAM_BOT_TOKEN=... \\
TELEGRAM_ALLOWED_USERS=... \\
TELEGRAM_HOME_CHANNEL=... \\
bash /workspace/hermes-agent-plugin/scripts/install_herorches_profile.sh
```

## Health Commands

Container-side manual checks:

```bash
python3 /workspace/hermes-agent-plugin/scripts/herorches_collect_health.py
python3 /workspace/hermes-agent-plugin/scripts/herorches_collect_health.py --json
python3 /workspace/hermes-agent-plugin/scripts/herorches_collect_health.py --profiles "herresearch herwiki" --json
```

Safe recovery:

```bash
bash /workspace/hermes-agent-plugin/scripts/herorches_safe_recover.sh --all
bash /workspace/hermes-agent-plugin/scripts/herorches_safe_recover.sh herresearch
```

## Host Watchdog

Windows host watchdog now follows an inspect-first, recover-second contract:

1. Ensure LM Studio API is reachable.
2. Ensure the shared model is loaded.
3. Ensure `hermes-sandbox` is running.
4. Collect deterministic fleet health JSON.
5. Run bounded recovery only when incidents are present.
6. Return deterministic exit code in `-RunOnce` mode.

Run once for diagnosis or Task Scheduler smoke test:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Watch-HermesStack.ps1 -RunOnce -ShowHealth
```

Continuous loop:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Watch-HermesStack.ps1 -IntervalSeconds 180
```

Optional Telegram alert from the host watchdog:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Watch-HermesStack.ps1 `
  -IntervalSeconds 180 `
  -NotifyBotToken "<herorches_bot_token>" `
  -NotifyChatId "<your_chat_id>"
```

### Run-once exit semantics

- `0`: healthy after optional recovery
- `2`: incidents remain after health collection and optional bounded recovery
- `3`: hard dependency/bootstrap failure such as LM Studio, Docker, or container visibility failure

### Notes

- The watchdog no longer calls the broad `herprofiles_recover.sh` path on every tick.
- Startup/bootstrap remains the job of `Start-HermesStack.ps1`.
- The watchdog only repairs when health JSON says the fleet is degraded.

## Operational Boundary

HerOrches is intentionally conservative.

It may:

- inspect health
- inspect logs
- restart gateways
- rerun recovery scripts

It must not automatically:

- replace auth tokens
- edit unrelated profile prompts/config
- wipe sessions or memories
- perform destructive container or git cleanup
