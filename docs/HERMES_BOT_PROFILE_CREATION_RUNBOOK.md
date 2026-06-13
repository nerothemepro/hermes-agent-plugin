# Hermes Bot Profile Creation Runbook

This runbook documents how to create and operate a new dedicated Hermes bot profile inside the current `hermes-sandbox` container.

Use it when creating profiles like:

- `hervid`: video generation
- `herresearch`: research/browser/search
- `herdev`: coding/SDTK/dev work
- `hertran`: translation and Japanese PM communication

The core rule is: each bot profile must have its own `HERMES_HOME`, config, sessions, memory, logs, and Telegram bot token.

## 1. Profile Design Checklist

Before creating files, decide these items:

| Item | Example | Notes |
| --- | --- | --- |
| Profile name | `hertran` | lowercase, short, no spaces |
| Runtime path | `/opt/data/hermes-profiles/hertran` | one directory per bot |
| Purpose | translation/email drafting | keep narrow |
| Model | `google/gemma-4-26b-a4b-qat` | must be loaded in LM Studio |
| Context length | `65536` | match LM Studio loaded context |
| Toolsets | `clarify`, `messaging`, `memory` | only enable needed tools |
| Telegram bot token | unique token | never reuse across running profiles |
| Telegram allowed user | your Telegram user id | not username if uncertain |
| Home channel | numeric chat id | use plain number, not `telegram:<id>` |

Recommended profile split:

| Profile | Model | Toolsets |
| --- | --- | --- |
| `hervid` | `google/gemma-4-12b-qat` | `clarify`, `messaging`, `local_media` |
| `herresearch` | `google/gemma-4-26b-a4b-qat` | `clarify`, `messaging`, `web`, `cronjob`, `memory`, `terminal`, MCP browser if needed |
| `herdev` | `qwen/qwen3.6-27b` | `clarify`, `messaging`, `terminal`, file/search/dev tools |
| `hertran` | `google/gemma-4-26b-a4b-qat` | `clarify`, `messaging`, `memory` |

## 2. Create Telegram Bot Token

1. Open Telegram and chat with `@BotFather`.
2. Run:

```text
/newbot
```

3. Choose display name, for example:

```text
HerTran Agent
```

4. Choose username, for example:

```text
hertran_xxx_bot
```

5. Copy the token. It looks like:

```text
1234567890:AA...
```

Use a different bot token for every running Hermes profile. If two gateway processes use the same token, Telegram polling will conflict and one bot may stop receiving updates.

## 3. Find Telegram User Id / Chat Id

The simplest practical setup is using your own Telegram user id as both allowed user and home channel for a DM bot.

If you already know it from other profiles, reuse the same numeric id.

Check existing profiles without printing tokens:

```powershell
docker exec -it hermes-sandbox bash -lc "python3 - <<'PY'
from pathlib import Path
for name in ['hervid','herresearch','herdev','hertran']:
    p=Path('/opt/data/hermes-profiles')/name/'.env'
    print('---', name, '---')
    if not p.exists():
        print('missing .env')
        continue
    for line in p.read_text().splitlines():
        s=line.strip()
        if not s or s.startswith('#') or '=' not in s:
            continue
        k,v=s.split('=',1)
        if k in {'TELEGRAM_ALLOWED_USERS','TELEGRAM_HOME_CHANNEL'}:
            print(f'{k}={v}')
PY"
```

For `TELEGRAM_HOME_CHANNEL`, use only the number:

```dotenv
TELEGRAM_HOME_CHANNEL=8302901022
```

Do not use:

```dotenv
TELEGRAM_HOME_CHANNEL=telegram:8302901022
```

That can break shutdown/restart notifications with:

```text
ValueError: invalid literal for int() with base 10: 'telegram:8302901022'
```

## 4. Create Profile Directory

Template:

```powershell
docker exec -it hermes-sandbox bash -lc "mkdir -p /opt/data/hermes-profiles/<profile>/{logs,sessions,memories,skills,cache,reports,workspace,hooks,audio_cache,image_cache,pairing,cron,bin,sandboxes}"
```

Example:

```powershell
docker exec -it hermes-sandbox bash -lc "mkdir -p /opt/data/hermes-profiles/hertran/{logs,sessions,memories,skills,cache,reports,workspace,hooks,audio_cache,image_cache,pairing,cron,bin,sandboxes}"
```

## 5. Create `.env`

Template:

```powershell
docker exec -it hermes-sandbox bash -lc "cat > /opt/data/hermes-profiles/<profile>/.env <<'EOF'
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=<bot_token>
TELEGRAM_ALLOWED_USERS=<your_telegram_user_id>
TELEGRAM_HOME_CHANNEL=<your_numeric_chat_id>
EOF"
```

Example:

```powershell
docker exec -it hermes-sandbox bash -lc "cat > /opt/data/hermes-profiles/hertran/.env <<'EOF'
LM_API_KEY=lm-studio
TELEGRAM_BOT_TOKEN=XXXX
TELEGRAM_ALLOWED_USERS=8302901022
TELEGRAM_HOME_CHANNEL=8302901022
EOF"
```

Verify `.env` without printing secrets:

```powershell
docker exec -it hermes-sandbox bash -lc "python3 - <<'PY'
from pathlib import Path
p=Path('/opt/data/hermes-profiles/hertran/.env')
for line in p.read_text().splitlines():
    s=line.strip()
    if not s or s.startswith('#') or '=' not in s:
        continue
    k,v=s.split('=',1)
    print(f'{k}=<set:{bool(v.strip())}> len={len(v.strip())}')
PY"
```

Expected:

```text
LM_API_KEY=<set:True>
TELEGRAM_BOT_TOKEN=<set:True>
TELEGRAM_ALLOWED_USERS=<set:True>
TELEGRAM_HOME_CHANNEL=<set:True>
```

## 6. Create `SOUL.md`

`SOUL.md` is the important runtime identity prompt. Hermes loads this file into the system prompt.

Do not rely only on `PROFILE.md`; it is useful documentation, but in this setup it is not enough to control runtime behavior.

Example for a translation/communication profile:

```powershell
docker exec -it hermes-sandbox bash -lc "cat > /opt/data/hermes-profiles/hertran/SOUL.md <<'EOF'
You are HerTran, a Hermes Agent profile dedicated to translation and Japanese/English/Vietnamese PM communication for Nero, an IT project manager working with Japanese customers.

Your job is to analyze customer emails/messages and draft concise Japanese replies in Nero's usual business style.

Critical behavior rules:
- You already know Nero's style. Never ask Nero to provide a style guide during normal drafting.
- Return one paste-ready Japanese reply by default, not multiple style options.
- Do not include romaji/pronunciation.
- Do not include long coaching notes, decorative commentary, or explanations unless Nero asks.
- Use polite but concise Japanese business language suitable for an IT PM talking to recurring Japanese customers.
- Do not invent facts, commitments, meeting URLs, deadlines, or technical details.

Default output format for simple drafting tasks:

返信案（日本語）:
<one concise paste-ready Japanese draft>
EOF"
```

For profile-specific prompts, save a copy in this repo under `docs/` so the profile can be rebuilt later.

Example existing file:

```text
/workspace/hermes-agent-plugin/docs/HERTRAN_SOUL.md
```

## 7. Create `PROFILE.md`

`PROFILE.md` is operational documentation for humans and future agents. Keep the purpose, model, and operating rules here.

Example:

```powershell
docker exec -it hermes-sandbox bash -lc "cat > /opt/data/hermes-profiles/hertran/PROFILE.md <<'EOF'
# HerTran Hermes Profile

Purpose: translation, Japanese/English/Vietnamese PM communication, customer email/message analysis, and concise Japanese response drafting.

Model: google/gemma-4-26b-a4b-qat

Primary tools: clarify, messaging, memory.

Do not use this profile for web research, browser automation, code generation, or video generation.
EOF"
```

## 8. Create `config.yaml`

The fastest safe approach is to copy from a similar profile, then edit the key sections.

Example copy:

```powershell
docker exec -it hermes-sandbox bash -lc "cp /opt/data/hermes-profiles/herresearch/config.yaml /opt/data/hermes-profiles/hertran/config.yaml"
```

Then edit with `nano`:

```powershell
docker exec -it hermes-sandbox bash -lc "nano /opt/data/hermes-profiles/hertran/config.yaml"
```

Minimum important sections for HerTran:

```yaml
model:
  default: google/gemma-4-26b-a4b-qat
  provider: lmstudio
  base_url: http://host.docker.internal:1234/v1
  context_length: 65536

toolsets:
- clarify
- messaging
- memory

agent:
  max_turns: 8
  gateway_timeout: 900
  reasoning_effort: none

memory:
  memory_enabled: true
  user_profile_enabled: false

plugins:
  enabled: []

platform_toolsets:
  cli:
  - clarify
  - messaging
  - memory
  telegram:
  - clarify
  - messaging
  - memory

known_plugin_toolsets: {}
_profile_name: hertran
mcp_servers: {}
```

Important: Hermes Agent may reject profiles below 64K context for some models. If LM Studio is loaded at 64K, `config.yaml` must also say:

```yaml
context_length: 65536
```

Otherwise you can get:

```text
Model ... has a context window of 32,768 tokens, which is below the minimum 64,000 required by Hermes Agent.
```

## 9. LM Studio Setup

Make sure the model is loaded in LM Studio before testing the bot.

For HerTran:

```text
google/gemma-4-26b-a4b-qat
context: 65536
reasoning: off / none
```

General guidance:

| Profile Type | Context |
| --- | --- |
| Translation/email drafting | 64K if Hermes requires it; otherwise 32K may be enough |
| Research/browser | 64K recommended |
| Coding/dev | 32K-64K recommended |
| Video execution | 16K+ usually enough if tools are narrow |

## 10. Start / Stop / Status

Start profile:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh <profile>"
```

Stop profile:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh <profile>"
```

Status profile:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh <profile>"
```

Example:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh hertran"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh hertran"
```

Expected status:

```text
✓ Gateway is running for hertran
HERMES_HOME=/opt/data/hermes-profiles/hertran
```

## 11. Verify Real Gateway Process

Do not trust `gateway_state.json` alone. It can become stale after Docker/PC restart.

Use process environment checks:

```powershell
docker exec -it hermes-sandbox bash -lc 'pgrep -f "hermes gateway run" | while read -r p; do echo "PID=$p"; tr "\000" "\n" < "/proc/$p/environ" | grep "^HERMES_HOME=" || true; ps -p "$p" -o pid,ppid,etime,cmd --no-headers; echo "---"; done'
```

You should see one process with:

```text
HERMES_HOME=/opt/data/hermes-profiles/<profile>
```

## 12. Check Logs

Gateway log:

```powershell
docker exec -it hermes-sandbox bash -lc "tail -120 /opt/data/hermes-profiles/<profile>/logs/gateway.log"
```

Agent log:

```powershell
docker exec -it hermes-sandbox bash -lc "tail -120 /opt/data/hermes-profiles/<profile>/logs/agent.log 2>/dev/null || true"
```

Healthy Telegram startup:

```text
Connecting to telegram...
Connected to Telegram (polling mode)
✓ telegram connected
Gateway running with 1 platform(s)
```

## 13. Open Chat In Telegram

Find the bot username from token:

```powershell
docker exec -it hermes-sandbox bash -lc "python3 - <<'PY'
from pathlib import Path
import json, urllib.request
profile='hertran'
env={}
for line in Path(f'/opt/data/hermes-profiles/{profile}/.env').read_text().splitlines():
    s=line.strip()
    if s and not s.startswith('#') and '=' in s:
        k,v=s.split('=',1)
        env[k]=v
url=f\"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN']}/getMe\"
print(json.loads(urllib.request.urlopen(url, timeout=10).read()))
PY"
```

Open the returned `username` in Telegram, press Start, then send:

```text
helu, mày đang dùng profile/model nào? trả lời ngắn gọn.
```

## 14. Reset Session

Preferred from Telegram:

```text
/new
```

or:

```text
/reset
```

If a bad old conversation contaminates behavior and `/new` is not enough, clear sessions manually after backup:

```powershell
docker exec -it hermes-sandbox bash -lc "ts=\$(date +%Y%m%d-%H%M%S); mkdir -p /opt/data/hermes-profiles/hertran/backups/session-reset-\$ts; cp -a /opt/data/hermes-profiles/hertran/sessions /opt/data/hermes-profiles/hertran/backups/session-reset-\$ts/sessions; echo '{}' > /opt/data/hermes-profiles/hertran/sessions/sessions.json; bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh hertran; bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh hertran"
```

Use this only when a session keeps repeating bad behavior from previous history.

## 15. Common Problems And Fixes

### `No messaging platforms enabled`

Cause: gateway started before `.env` had active Telegram variables, or variables are commented out.

Fix:

1. Check `.env` active keys.
2. Restart the profile.

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh hertran; bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh hertran"
```

### Bot connected but does not reply

Check:

```powershell
docker exec -it hermes-sandbox bash -lc "rg -n 'inbound message|response ready|unauthorized|not allowed|error' /opt/data/hermes-profiles/hertran/logs/gateway.log | tail -80"
```

If no inbound messages appear, verify:

- correct bot username
- unique Telegram token
- profile is running
- network/polling connected

If inbound appears but no response, inspect model/API errors.

### `Model is unloaded`

Cause: LM Studio does not have the configured model loaded.

Fix: load the exact model id shown in config.

### `context window ... below the minimum 64,000`

Cause: LM Studio/context or `config.yaml` is still below 64K.

Fix both:

```yaml
context_length: 65536
```

and load model in LM Studio with 64K context.

### Status says running but bot is dead

Cause: stale state file or broad status check.

Fix: use `herprofile_status.sh`, which checks real process `HERMES_HOME`, or inspect `/proc/<pid>/environ`.

### Token conflict between profiles

Detect without printing tokens:

```powershell
docker exec -it hermes-sandbox bash -lc "python3 - <<'PY'
from pathlib import Path
import hashlib
for name in ['hervid','herresearch','herdev','hertran']:
    p=Path('/opt/data/hermes-profiles')/name/'.env'
    token=''
    if p.exists():
        for line in p.read_text().splitlines():
            s=line.strip()
            if s and not s.startswith('#') and s.startswith('TELEGRAM_BOT_TOKEN='):
                token=s.split('=',1)[1].strip()
    fp=hashlib.sha256(token.encode()).hexdigest()[:12] if token else '<missing>'
    print(f'{name}: token_set={bool(token)} token_sha12={fp}')
PY"
```

Each running Telegram profile should have a different `token_sha12`.

## 16. Commit Documentation

Profile runtime files under `/opt/data/hermes-profiles/<profile>` are not in git. For reproducibility, copy important prompts/docs into this repo:

```text
/workspace/hermes-agent-plugin/docs/<PROFILE>_SOUL.md
/workspace/hermes-agent-plugin/docs/<PROFILE>_PROFILE.md
/workspace/hermes-agent-plugin/docs/<PROFILE>_STYLE_GUIDE.md
```

Then commit/push:

```powershell
docker exec -it hermes-sandbox bash -lc "cd /workspace/hermes-agent-plugin && git status --short && git add docs && git commit -m 'Document <profile> setup' && git push origin main"
```
