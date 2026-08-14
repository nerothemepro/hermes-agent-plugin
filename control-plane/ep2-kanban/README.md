# Episode 2 Kanban Viewer

The Episode 2 workflow uses the existing SDTK-AGENT ledger as the canonical
source for run state. The read-only projector turns that ledger plus the
owner-approved ten-episode manifest into the Markdown surfaces expected by the
stock SDTK-WIKI Kanban viewer:

- `governance/ai/core/IMPROVEMENT_BACKLOG.md` - series roadmap;
- `SHARED_PLANNING.md` - current EP2 pipeline; and
- `QUALITY_CHECKLIST.md` - owner gates only.

Generated files are deliberately ignored by Git. Do not edit them: change the
series manifest for roadmap decisions, or let `sdtk-agent` update its own
ledger for execution state.

Run a one-shot local projection:

```bash
control-plane/ep2-kanban/start-projector.sh --once
```

The supervised projector re-runs every 15 seconds after deployment. It does not
dispatch, approve, publish, send Telegram messages, read credentials, or write
below `.sdtk/agent-runtime`.

The viewer launcher remains localhost only:

```text
/workspace/hermes-agent-plugin/control-plane/ep2-kanban/start-ep2-kanban.sh
```

The Runs lane is read-only and displays each durable run's identifier, status, current task, or waiting owner gate. It never dispatches, approves, publishes, or exposes environment values.

The launcher does not enable a tunnel. For a temporary host review from Docker/WSL, the owner must separately authorize a direct `sdtk-wiki kanban --project <path> --tunnel --no-open` command; Cloudflare quick tunnels are public and the URL changes each time the process restarts.

No `supervisord` program is included. Persistent host access requires a separately reviewed localhost-only port mapping or authenticated proxy.
