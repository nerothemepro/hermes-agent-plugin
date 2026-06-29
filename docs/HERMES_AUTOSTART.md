# Hermes Auto-Start (all profiles on container start)

## Problem

The container has **no init system** — PID 1 is `sleep infinity`. When the
container is (re)started, only that command runs, so none of the profile
gateways come up automatically:

- `hervid` — video generation
- `herresearch` — research/browser/CLI
- `herdev` — dev/code
- `hertran` — translation / PM drafting
- `herwiki` — wiki maintenance

Result: chatting with the agents on Telegram gets no reply until the gateways
are started by hand.

## The boot script

`scripts/herprofiles_boot.sh` starts every profile gateway that is not already
running. It is **idempotent**: it detects a live gateway by matching
`HERMES_HOME` in `/proc/<pid>/environ`, so running it repeatedly is safe and it
will also restart any gateway that has died.

```bash
# Start all missing profiles, then exit (one-shot)
bash /workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh

# Start all, then hold the foreground — use this as the container CMD
bash /workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh --keep-alive
```

Manual recovery after restart:

```bash
bash /workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh
```

This is safer than a blind restart because it starts only profiles that are actually down. Use `--restart` only when you intentionally want to stop/start all profiles.


Profile list defaults to the known live profiles `hervid herresearch herdev hertran herwiki hersocial` and auto-adds `herorches` only when that profile directory exists. Override with the `HERMES_PROFILES` env var.

## Data safety

`/workspace` and `/opt/data` are **named Docker volumes**
(`hermes-workspace`, `hermes-data`). Recreating the container does **not** lose
the repo, the venv, the profiles, or model config — they live in the volumes.

## This deployment: `hermes-sandbox` on Docker Desktop

- Container name: **hermes-sandbox**, image **hermes-sandbox-image:latest**
- `Cmd: ["sleep", "infinity"]`, `Entrypoint: ["docker-entrypoint.sh"]`
  (`/usr/local/bin/docker-entrypoint.sh`, the stock Node image entrypoint).
- **Docker Desktop GUI cannot edit the Cmd of an existing container** (Inspect is
  read-only), so Option A's command override is not reachable from the GUI here.

### Chosen method — entrypoint hook (survives Stop/Start)

The entrypoint runs on every container start, so the boot call is injected there,
just before `exec "$@"`:

```sh
HERMES_BOOT=/workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh
if [ -f "$HERMES_BOOT" ]; then
  bash "$HERMES_BOOT" || true
fi
```

- The original is backed up at
  `/usr/local/bin/docker-entrypoint.sh.bak.pre-hermes-autostart`.
- This edit is in the container's **writable layer**: it **survives Stop/Start**
  (same container) but is **lost on recreate/rebuild** from the image.
- To verify: in Docker Desktop, Stop then Start `hermes-sandbox`; all four
  gateways should come up (`✓ telegram connected` in each profile log).

### Make it permanent across recreate (host-side, in the Dockerfile)

The edit above is not in a volume, so rebuilding the image drops it. To bake it
in, add this to the `hermes-sandbox-image` Dockerfile (on the host) after the
entrypoint exists:

```dockerfile
RUN sed -i 's|^exec "\$@"|HERMES_BOOT=/workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh\nif [ -f "$HERMES_BOOT" ]; then bash "$HERMES_BOOT" || true; fi\n\nexec "$@"|' /usr/local/bin/docker-entrypoint.sh
```

## Option A — bake the boot script into the container command

Do this once; afterwards every Start brings up all four agents automatically.

**Portainer:**
1. Containers → select the Hermes container.
2. **Duplicate/Edit**.
3. **Command & logging** → set **Command** to:
   ```
   bash /workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh --keep-alive
   ```
4. Leave Volumes / Network / Env / Ports unchanged.
5. **Deploy the container** (recreates it).

`--keep-alive` keeps the container alive (`exec sleep infinity`) after the
gateways are started, replacing the old `sleep infinity` CMD.

> Plain Docker Desktop GUI cannot edit the command of an existing container —
> use Option B, or recreate via `docker run` / compose.

**Equivalent `docker run` command override** (keep your real volume/env/port
flags from the existing container):

```bash
docker run -d --name <container-name> \
  -v hermes-workspace:/workspace -v hermes-data:/opt/data \
  <other-existing-flags> \
  <image> \
  bash /workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh --keep-alive
```

## Option B — host-side hook (no recreate)

Run the boot script via `docker exec` after the container starts. Because the
script is idempotent, you can run it at logon and/or on a short interval to also
self-heal crashed gateways.

```bash
docker exec <container-name> bash /workspace/hermes-agent-plugin/scripts/herprofiles_boot.sh
```

On Windows (Docker Desktop on WSL2), wire that into **Task Scheduler** at logon
(and optionally every 5 minutes).

## Verify

```bash
# From inside the container:
for p in hervid herresearch herdev hertran; do
  bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh "$p"
done
```

Each profile log should show `✓ telegram connected`:

```
/opt/data/hermes-profiles/<profile>/logs/gateway.log
```

## Host watchdog complement

Container boot alone is not enough for full-stack recovery because LM Studio runs on the Windows host. Pair container auto-start with the host-side watchdog:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Watch-HermesStack.ps1 -RunOnce
```

Recommended operational split:

- container entrypoint hook: make sure gateways come up when the container starts
- host startup script: make sure LM Studio + Docker + gateway recovery run after login
- host watchdog one-shot via Task Scheduler: periodic health check and bounded repair
