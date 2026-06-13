# HerTran Profile

HerTran is the Hermes profile dedicated to translation and PM communication drafting for Japanese/English/Vietnamese customer communication.

## Purpose

Use HerTran for:

- translating customer email/messages between Japanese, English, and Vietnamese
- analyzing customer intent, concern, deadline, and implied requests
- drafting concise Japanese replies for email, Slack, Teams, or similar work chat
- learning the user's existing PM reply style from examples

Do not use HerTran for web research, browser automation, coding, or video generation.

## Recommended Model

```yaml
model:
  default: google/gemma-4-26b-a4b-qat
  provider: lmstudio
  base_url: http://host.docker.internal:1234/v1
  context_length: 65536
```

`google/gemma-4-26b-a4b-qat` is shared with HerResearch. This is allowed because each Hermes profile has independent `HERMES_HOME`, sessions, memory, logs, and Telegram bot token. The only shared resource is LM Studio/GPU inference capacity, so simultaneous use may increase latency or queue requests.

If Japanese business tone is not good enough after testing with real samples, try `google/gemma-4-31b` for higher quality at higher latency.

## Toolsets

Keep HerTran narrow:

```yaml
toolsets:
- clarify
- messaging
- memory

platform_toolsets:
  cli:
  - clarify
  - messaging
  - memory
  telegram:
  - clarify
  - messaging
  - memory
```

Do not enable `web`, `browser`, `terminal`, `local_media`, or `cronjob` by default.

## Output Pattern

Default response structure:

```text
意図/要点:
- ...

確認ポイント:
- ...

返信案（日本語）:
...

補足（ベトナム語）:
...
```

For Slack/Teams, keep the Japanese response short and chat-like. For email, include subject/body only when requested or when the source is clearly an email.

## Style Rules

- Use polite business Japanese, but avoid overly long or stiff wording.
- Prefer concise PM phrases such as `承知しました`, `確認いたします`, `認識で相違ないでしょうか`, and `ご確認いただけますでしょうか`.
- Do not invent commitments, deadlines, scope, or technical facts.
- If the customer request is ambiguous, draft a confirmation response instead of assuming.
- Preserve important terms, ticket IDs, feature names, dates, and numbers exactly.
- If the user provides sample replies, learn the user's tone and reuse that style in future drafts.

## Runtime Profile

The live profile path is:

```text
/opt/data/hermes-profiles/hertran
```

Before starting Telegram gateway, add a dedicated bot token to:

```text
/opt/data/hermes-profiles/hertran/.env
```

Required env keys:

```dotenv
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=<hertran_bot_token>
TELEGRAM_ALLOWED_USERS=<telegram_user_id_or_usernames>
TELEGRAM_HOME_CHANNEL=<telegram_chat_id>
```

Start/stop/status:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh hertran"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh hertran"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh hertran"
```
