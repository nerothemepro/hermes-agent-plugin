# Episode 2 Kanban Viewer

The Episode 2 workflow uses the existing SDTK-AGENT ledger as the canonical source for run state. This launcher opens the stock SDTK-WIKI Kanban viewer on localhost only:

```text
/workspace/hermes-agent-plugin/control-plane/ep2-kanban/start-ep2-kanban.sh
```

The Runs lane is read-only and displays each durable run's identifier, status, current task, or waiting owner gate. It never dispatches, approves, publishes, or exposes environment values.

The launcher does not enable a tunnel. For a temporary host review from Docker/WSL, the owner must separately authorize a direct `sdtk-wiki kanban --project <path> --tunnel --no-open` command; Cloudflare quick tunnels are public and the URL changes each time the process restarts.

No `supervisord` program is included. Persistent host access requires a separately reviewed localhost-only port mapping or authenticated proxy.
