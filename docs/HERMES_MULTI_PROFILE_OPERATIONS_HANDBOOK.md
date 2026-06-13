# Hermes Multi-Profile Operations Handbook

Date: 2026-06-11

This handbook summarizes the current local Hermes multi-profile setup and the commandline checks used to operate it.

Related architecture document:

```text
/workspace/HERMES_MULTI_PROFILE_ARCHITECTURE.md
```

## Current Profiles

All profiles run inside the same `hermes-sandbox` container, but each profile has its own `HERMES_HOME`, config, logs, sessions, memory, and gateway process.

```text
/opt/data/hermes-profiles/hervid
/opt/data/hermes-profiles/herresearch
/opt/data/hermes-profiles/herdev
/opt/data/hermes-profiles/hertran
```

## Profile Roles

| Profile | Purpose | Model | Main toolsets |
| --- | --- | --- | --- |
| `hervid` | Generate marketing/social videos through ComfyUI + Wan2.1 | `google/gemma-4-12b-qat` | `clarify`, `messaging`, `local_media` |
| `herresearch` | Research, synthesize reports, cron/news briefing | `google/gemma-4-26b-a4b-qat` | `clarify`, `messaging`, `web`, `cronjob`, `memory` |
| `herdev` | Coding/dev work with SDTK and local repos | `qwen/qwen3.6-27b` | `clarify`, `messaging`, `terminal`, `file`, `search` |
| `hertran` | Translation and PM communication drafting for Japanese/English/Vietnamese email, Slack, and Teams messages | `google/gemma-4-26b-a4b-qat` | `clarify`, `messaging`, `memory` |

## External Services

These services must be reachable from `hermes-sandbox`:

```text
LM Studio API: http://host.docker.internal:1234/v1
ComfyUI:       http://host.docker.internal:8188
Wan2.1 API:    http://host.docker.internal:8010
```

Only `hervid` needs ComfyUI and Wan2.1 for normal work. All profiles need LM Studio.

## Important LM Studio Settings

Hermes config may say `context_length: 65536`, but the real limit is the context loaded in LM Studio. If LM Studio loads a model with `n_ctx=4096`, Hermes can still fail with context overflow.

Recommended minimums:

```text
hervid / google/gemma-4-12b-qat:        16384 context
herresearch / google/gemma-4-26b-a4b-qat: 32768 context recommended
herdev / qwen/qwen3.6-27b:              32768 context recommended
hertran / google/gemma-4-26b-a4b-qat:   65536 context required
```

Known HerResearch failure pattern:

```text
n_keep: 4975 >= n_ctx: 4096
Context length exceeded
```

Fix: increase context in LM Studio, reload the model, restart `herresearch`, then send `/new` in Telegram.

## Start, Stop, Status

Run these from Windows PowerShell.

Start all profiles:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh hervid"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh herresearch"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh herdev"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh hertran"
```

Stop all profiles:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh hervid"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh herresearch"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh herdev"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh hertran"
```

Restart one profile:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh herresearch; bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh herresearch"
```

Check status:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh hervid"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh herresearch"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh herdev"
```

## Verify Process and Gateway State

List Hermes gateway processes:

```powershell
docker exec -it hermes-sandbox bash -lc "pgrep -af 'hermes gateway run|/workspace/.venvs/hermes-agent/bin/hermes'"
```

Read profile state files:

```powershell
docker exec -it hermes-sandbox bash -lc "cat /opt/data/hermes-profiles/hervid/gateway_state.json"
docker exec -it hermes-sandbox bash -lc "cat /opt/data/hermes-profiles/herresearch/gateway_state.json"
docker exec -it hermes-sandbox bash -lc "cat /opt/data/hermes-profiles/herdev/gateway_state.json"
```

Confirm the PID in `gateway_state.json` is alive:

```powershell
docker exec -it hermes-sandbox bash -lc "ps -p <PID> -o pid,ppid,stat,etime,cmd"
```

If `gateway_state.json` says `running` but `ps -p <PID>` returns no process, the state file is stale. Start that profile again.

## Log Checks

Read latest gateway logs:

```powershell
docker exec -it hermes-sandbox bash -lc "tail -120 /opt/data/hermes-profiles/hervid/logs/gateway.log"
docker exec -it hermes-sandbox bash -lc "tail -120 /opt/data/hermes-profiles/herresearch/logs/gateway.log"
docker exec -it hermes-sandbox bash -lc "tail -120 /opt/data/hermes-profiles/herdev/logs/gateway.log"
```

Filter for useful operational events:

```powershell
docker exec -it hermes-sandbox bash -lc "grep -E 'Connected to Telegram|inbound message|response ready|API call failed|Context length exceeded|n_ctx|already in use|ERROR' /opt/data/hermes-profiles/hervid/logs/gateway.log | tail -80"
docker exec -it hermes-sandbox bash -lc "grep -E 'Connected to Telegram|inbound message|response ready|API call failed|Context length exceeded|n_ctx|already in use|ERROR' /opt/data/hermes-profiles/herresearch/logs/gateway.log | tail -80"
docker exec -it hermes-sandbox bash -lc "grep -E 'Connected to Telegram|inbound message|response ready|API call failed|Context length exceeded|n_ctx|already in use|ERROR' /opt/data/hermes-profiles/herdev/logs/gateway.log | tail -80"
```

Key healthy log lines:

```text
Connected to Telegram (polling mode)
✓ telegram connected
Gateway running with 1 platform(s)
inbound message: platform=telegram ...
response ready: platform=telegram ...
```

## LM Studio Checks

Check that LM Studio is reachable and models are loaded:

```powershell
docker exec -it hermes-sandbox bash -lc "curl -s --connect-timeout 5 http://host.docker.internal:1234/v1/models | jq -r '.data[].id'"
```

Expected models include:

```text
google/gemma-4-12b-qat
google/gemma-4-26b-a4b-qat
qwen/qwen3.6-27b
```

If the model appears but requests fail with context errors, adjust the model context in LM Studio and reload the model.

## Service Checks for HerVid

ComfyUI health:

```powershell
docker exec -it hermes-sandbox bash -lc "curl -s --connect-timeout 10 http://host.docker.internal:8188/system_stats | jq '.devices[0].name, .devices[0].vram_free'"
```

Wan2.1 health:

```powershell
docker exec -it hermes-sandbox bash -lc "curl -s --connect-timeout 10 http://host.docker.internal:8010/health | jq"
```

Check ComfyUI key models:

```powershell
docker exec -it hermes-sandbox bash -lc "curl -s http://host.docker.internal:8188/object_info/CheckpointLoaderSimple | jq -r '.CheckpointLoaderSimple.input.required.ckpt_name[0][]?'"
docker exec -it hermes-sandbox bash -lc "curl -s http://host.docker.internal:8188/object_info/FrameInterpolationModelLoader | jq -r '.FrameInterpolationModelLoader.input.required.model_name[1].options[]?'"
```

Expected useful models:

```text
animagine-xl-3.1.safetensors
flux1-schnell-fp8.safetensors
rife_v4.26.safetensors
```

## Browser Automation for HerResearch

For tasks like hotel search, filter, and availability checks, add a browser MCP server to `herresearch`.

Recommended server:

```text
Playwright MCP
```

Why this one:

- structured browser automation with Playwright
- no vision model required
- good fit for local LLMs like `google/gemma-4-26b-a4b-qat`
- more controlled than a fully autonomous browser agent

Safety rule:

- allow search/filter/read-only actions first
- do not let the agent confirm checkout/payment without a human approval step

Files added in the repo:

```text
/workspace/hermes-agent-plugin/configs/playwright-mcp.herresearch.json
/workspace/hermes-agent-plugin/scripts/playwright_mcp_server.sh
/workspace/hermes-agent-plugin/scripts/setup_playwright_mcp.sh
```

Install flow inside `hermes-sandbox`:

```bash
bash /workspace/hermes-agent-plugin/scripts/setup_playwright_mcp.sh herresearch
```

What that script does:

1. checks that `node` and `npx` exist
2. installs Linux system dependencies required by Chromium
3. installs Chromium browser binaries for Playwright MCP
4. removes any stale `playwright` MCP entry
5. adds the MCP server to the `herresearch` profile and non-interactively enables all browser tools
6. tests the MCP connection

Smoke-test Chromium outside Hermes:

```powershell
docker exec -it hermes-sandbox bash -lc "npx -y playwright@latest screenshot --browser=chromium https://sdtk.dev /tmp/herresearch-playwright-smoke.png"
```

Verify MCP config directly:

```powershell
docker exec -it hermes-sandbox bash -lc "HERMES_HOME=/opt/data/hermes-profiles/herresearch /workspace/.venvs/hermes-agent/bin/hermes mcp list"
docker exec -it hermes-sandbox bash -lc "HERMES_HOME=/opt/data/hermes-profiles/herresearch /workspace/.venvs/hermes-agent/bin/hermes mcp test playwright"
```

Afterwards, reload the profile MCP tools:

```text
/reload-mcp
```

Then verify the browser tools are visible by asking:

```text
What MCP-backed tools are available right now?
```

If you need a more restricted browser surface later, add `tools.include` / `tools.exclude` to the MCP server config in `config.yaml`.


Operational rule for booking/search sites:

- Do not use Playwright `waitUntil: "networkidle"` on sites like Jalan.net, Booking.com, Agoda, or Rakuten Travel. These pages often keep analytics/ad/API requests open forever.
- Use `domcontentloaded`, visible text, URL changes, or specific selectors instead.
- Keep waits bounded: 10-15s for selectors, 30-45s for navigation.
- If stuck, return page title, URL, visible text, and blocker rather than continuing silently.
- Do not call `browser_type` with an empty selector/ref. Use a concrete snapshot ref or switch to `browser_run_code_unsafe`.
- For Jalan.net, stable hotel-form selectors include `#jalan_form`, `#dyn_y_txt`, `#dyn_m_txt`, `#dyn_d_txt`, `#dyn_stay_txt`, `#dyn_room_num`, `#dyn_adult_num`, `#ken_list`, `#area_list`, `#research_02`; Tochigi `kenCd` is `080000`.
- Avoid broad text locators like `text=宿・ホテル`; they match multiple elements and trigger strict-mode violations.

## Telegram Smoke Tests

After restart, open each Telegram bot and send:

```text
/new
```

Then test each profile.

HerVid:

```text
helu HerVid, mày đang dùng model/tool profile nào? trả lời ngắn gọn.
```

HerResearch:

```text
Tóm tắt 3 tin AI mới nhất hôm nay, kèm link nguồn và ngày nguồn.
```

HerDev:

```text
Hãy trả lời bằng tiếng Việt. Mày đang dùng profile/model nào và có những tool chính nào?
```

## Common Failures and Root Causes

### Gateway says running, but bot does not reply

Check actual process:

```powershell
docker exec -it hermes-sandbox bash -lc "pgrep -af 'hermes gateway run|/workspace/.venvs/hermes-agent/bin/hermes'"
```

If the PID in `gateway_state.json` is missing, state is stale. Start the profile again.

### Telegram bot token already in use

Typical log:

```text
Telegram bot token already in use (PID ...)
```

Meaning: another gateway process or stale lock is using the same bot token. First check real gateway processes with `pgrep`. Do not delete lock files until the PID has been confirmed dead/stale.

### Playwright MCP missing or Chromium dependency errors

Typical logs:

```text
No MCP servers configured.
Server 'playwright' not found in config.
Browser "chromium" is not installed.
Missing system dependencies required to run browser chromium
Install them with: sudo npx playwright install-deps chromium
Chromium sandboxing failed!
```

Meanings:

- `No MCP servers configured` / `playwright not found`: setup was not run, or a previous `mcp add` was cancelled before saving.
- `Browser "chromium" is not installed`: Playwright browser binaries are missing.
- `Missing system dependencies`: Chromium binary exists, but Linux libraries required by headless Chromium are missing in the container.
- `Chromium sandboxing failed`: Chromium is installed but cannot use its sandbox in this container/WSL environment; set `browser.launchOptions.chromiumSandbox=false` and pass `--no-sandbox` in `configs/playwright-mcp.herresearch.json`.

Run the Playwright MCP setup script again as root inside `hermes-sandbox`:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/setup_playwright_mcp.sh herresearch"
```

Then restart `herresearch`:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh herresearch; bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh herresearch"
```

Confirm state:

```powershell
docker exec -it hermes-sandbox bash -lc "cat /opt/data/hermes-profiles/herresearch/gateway_state.json"
```

Smoke-test the exact MCP browser launch config:

```powershell
docker exec -it hermes-sandbox bash -lc "node -e \"const fs=require('fs'); const { chromium }=require('/root/.npm/_npx/9833c18b2d85bc59/node_modules/playwright'); (async()=>{const cfg=JSON.parse(fs.readFileSync('/workspace/hermes-agent-plugin/configs/playwright-mcp.herresearch.json','utf8')); const c=await chromium.launchPersistentContext('/tmp/herresearch-playwright-config-smoke-profile',{...cfg.browser.launchOptions,...cfg.browser.contextOptions}); const p=c.pages()[0]||await c.newPage(); await p.goto('https://sdtk.dev/',{waitUntil:'domcontentloaded'}); console.log(await p.title()); await c.close();})().catch(e=>{console.error(e);process.exit(1)})\""
```

### HerResearch context overflow

Typical log:

```text
n_keep: 4975 >= n_ctx: 4096
Context length exceeded
```

Meaning: LM Studio loaded the model with too small a context. Increase LM Studio context for `google/gemma-4-26b-a4b-qat`, reload the model, restart HerResearch, and send `/new`.

### Web extract error with DDGS

Typical log:

```text
DuckDuckGo (ddgs) is a search-only backend and cannot extract URL content.
```

Meaning: DDGS can search but cannot extract full web page content. For full extraction, configure `web.extract_backend` with a provider such as Tavily, Firecrawl, Exa, or Parallel and provide its API key.

### Shutdown notification error with Telegram home channel

Typical old log:

```text
invalid literal for int() with base 10: 'telegram:8302901022'
```

Meaning: `TELEGRAM_HOME_CHANNEL` was set as `telegram:<id>`. It should be the raw numeric chat ID only:

```text
8302901022
```

## Normal Recovery Procedure

Use this sequence when a profile is silent:

1. Check LM Studio:

```powershell
docker exec -it hermes-sandbox bash -lc "curl -s --connect-timeout 5 http://host.docker.internal:1234/v1/models | jq -r '.data[].id'"
```

2. Check profile status:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh <profile>"
```

3. Check actual process:

```powershell
docker exec -it hermes-sandbox bash -lc "pgrep -af 'hermes gateway run|/workspace/.venvs/hermes-agent/bin/hermes'"
```

4. Restart profile:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_stop.sh <profile>; bash /workspace/hermes-agent-plugin/scripts/herprofile_start.sh <profile>"
```

5. Wait 5-10 seconds, then check log:

```powershell
docker exec -it hermes-sandbox bash -lc "tail -80 /opt/data/hermes-profiles/<profile>/logs/gateway.log"
```

6. In Telegram, send:

```text
/new
```

7. Send a short smoke-test message.

## Current Working Assumption

Manual routing is the recommended workflow:

```text
HerVid: video generation
HerResearch: research/report/cron
HerDev: code/app/SDTK work
```

Do not add a router agent until these three profiles are stable for daily use.
