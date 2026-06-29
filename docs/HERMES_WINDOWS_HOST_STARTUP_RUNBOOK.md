# Hermes Windows Host Startup Runbook

This runbook covers the host-side startup flow for LM Studio plus the Docker-based Hermes stack.

Use this together with:

- [HERMES_LMSTUDIO_PRELOAD_STRATEGY.md](/workspace/hermes-agent-plugin/docs/HERMES_LMSTUDIO_PRELOAD_STRATEGY.md:1)
- [HERMES_AUTOSTART.md](/workspace/hermes-agent-plugin/docs/HERMES_AUTOSTART.md:1)

## Purpose

After Windows reboot, bring the full stack up with minimal manual work:

1. Start LM Studio server.
2. Load the shared text model used by the always-on Hermes bots.
3. Start the `hermes-sandbox` Docker container.
4. Recover all Hermes gateways inside the container.
5. Optionally warm HerVid or HerDev on demand.

## Scripts

Host-side scripts:

- [Start-HermesStack.ps1](/workspace/hermes-agent-plugin/scripts/windows/Start-HermesStack.ps1:1)
- [Warm-HerVid.ps1](/workspace/hermes-agent-plugin/scripts/windows/Warm-HerVid.ps1:1)
- [Warm-HerDev.ps1](/workspace/hermes-agent-plugin/scripts/windows/Warm-HerDev.ps1:1)
- [HermesHostCommon.ps1](/workspace/hermes-agent-plugin/scripts/windows/HermesHostCommon.ps1:1)

## Assumptions

These scripts assume:

1. `lms` is installed and available on the Windows host PATH.
2. Docker Desktop is installed and running.
3. The Docker container name is `hermes-sandbox`.
4. You have already saved the desired per-model defaults in LM Studio once through the UI.

The scripts intentionally load by model id only. They do not hard-code LM Studio CLI context flags. This keeps the automation aligned with the per-model defaults you already tuned manually.

## Default Policy

`Start-HermesStack.ps1` preloads:

- `google/gemma-4-26b-a4b-qat`

It does not preload by default:

- `google/gemma-4-12b-qat`
- `qwen/qwen3.6-27b`

That matches the current strategy:

- shared always-on model for `herresearch`, `herwiki`, `hersocial`
- optional on-demand warm-up for `hervid`
- optional on-demand warm-up for `herdev`
- optional HerOrches profile recovery after it is installed

## Usage

### Full startup after reboot

From the local clone root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Start-HermesStack.ps1 -ShowStatus
```

### Full startup and also warm HerVid

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Start-HermesStack.ps1 -WarmHerVid -ShowStatus
```

### Warm HerVid only when you plan to generate video

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Warm-HerVid.ps1 -ShowLoadedModels
```

### Warm HerDev only when you plan to code

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Warm-HerDev.ps1 -ShowLoadedModels
```

## What The Main Startup Script Does

`Start-HermesStack.ps1` performs these actions:

1. `lms server start`
2. Wait for `http://127.0.0.1:1234/v1/models`
3. `lms load google/gemma-4-26b-a4b-qat`
4. `docker start hermes-sandbox`
5. `docker exec hermes-sandbox bash /workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh`
6. Optional profile status output

## Task Scheduler

Recommended setup:

1. Open Windows Task Scheduler.
2. Create a task triggered at logon.
3. Program/script:

```text
powershell.exe
```

4. Arguments:

```text
-ExecutionPolicy Bypass -File D:\Workspace\Video_gen_extension\hermes-agent-plugin\scripts\windows\Start-HermesStack.ps1
```

Replace the file path with your real local repo path.

## Verification

Check loaded LM Studio models:

```powershell
lms ps
```

Check Hermes gateways:

```powershell
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh hervid"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh herresearch"
docker exec -it hermes-sandbox bash -lc "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh hersocial"
```

Check that the container can see LM Studio:

```powershell
docker exec -it hermes-sandbox bash -lc "curl -s --connect-timeout 5 http://host.docker.internal:1234/v1/models | jq -r '.data[].id'"
```

## Notes

- If HerVid fails with `Context length exceeded`, the real LM Studio context is too small even if the Hermes profile config says `65536`.
- If HerVid LTX render runs, LM Studio models may be unloaded intentionally to free VRAM. That behavior is expected on this machine.
