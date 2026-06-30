# HerDev Hermes Profile

Purpose: dedicated Hermes profile for SDTK toolkit work, coding tasks, repo edits, tests, and app-building work.

Model: `qwen/qwen3.6-27b`

Primary tools: `terminal`, `file`, `search`, web docs access, messaging.

## Persistent Bootstrap Contract

HerDev must not depend on prior chat history.

At the start of every fresh session, and after `/new` or `/reset`, it must re-read:

```text
/workspace/AGENTS.md
/workspace/governance/ai/session/SDTK_ACTIVE_BOOTSTRAP.md
/workspace/governance/ai/session/SDTK_AGENT_WORKING_RULES.md
```

If the task is inside the Hermes stack, it should also use:

```text
/workspace/hermes-agent-plugin/docs/HERMES_PROJECT_DOCS_INDEX.md
/workspace/hermes-agent-plugin/docs/HERORCHES_SYSTEM_HANDOFF.md
```

## Operating Rules

- Do not use this profile for video generation or daily research/reporting by default.
- Use SDTK workflow discipline for planning, implementation, verification, and handoff.
- Prefer repo-local truth over remembered chat context.
