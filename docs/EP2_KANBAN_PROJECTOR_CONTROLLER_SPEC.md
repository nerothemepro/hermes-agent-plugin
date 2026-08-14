# EP2 Kanban Projector - Controller Spec

## Status

Proposed. This specification implements the owner-approved Build With Proof R2
roadmap order and exposes attended Episode 2 execution in the existing
SDTK-WIKI Kanban viewer.

## Objective

Make the existing web Kanban viewer show three consistent layers without
creating a second mutable workflow system:

1. the ten-episode marketing-video roadmap;
2. the active Episode 2 pipeline and owner gates; and
3. the current `sdtk-agent` run state.

## Canonical Sources And Ownership

| Surface | Canonical source | Writer | Viewer behaviour |
|---|---|---|---|
| Series backlog | `control-plane/ep2-kanban/marketing-video-series.json` | Human-reviewed repository configuration | Backlog Board |
| Run and task state | `.sdtk/agent-runtime/runs/<run_id>/state.json` | `sdtk-agent` only | Runs lane and projector input |
| Pipeline and quality views | Root `SHARED_PLANNING.md` and `QUALITY_CHECKLIST.md` | Projector only | Pipeline and Quality tabs |

The projector must never write a run ledger, dispatch a worker, approve a gate,
publish content, read credentials, or send a Telegram message.

## R2 Episode Backlog

| Episode | Title | Status at seed |
|---|---|---|
| EP1 | Stop Describing UI Bugs to AI | DONE |
| EP2 | What Is Your AI Coding Actually Costing? | IN_PROGRESS |
| EP3 | From Client Comment to a Precise Patch | TODO |
| EP4 | One Requirement, a Reviewable Plan | TODO |
| EP5 | Your Markdown Is Already a Kanban Board | TODO |
| EP6 | AI Wrote the Patch. The Gate Caught the Problem. | TODO |
| EP7 | Your Repo Should Remember Between Agent Sessions | TODO |
| EP8 | Build a Local Second Brain for an Agent | TODO |
| EP9 | An Agent Workflow That Stops for You | TODO |
| EP10 | How This Channel Refuses to Fake Proof | TODO |

## State Projection

The projector maps the active run ledger one-way:

| Ledger state | Projected state |
|---|---|
| `created` | `TODO` |
| `running`, `submitted`, `running_external`, `waiting_external_evidence` | `IN_PROGRESS` |
| `waiting_for_approval` | `PENDING` |
| `completed`, `skipped` | `DONE` |
| `blocked`, `failed`, `cancelled`, timeout states | `PENDING`, with factual reason |

Human gates remain `PENDING` until the ledger records their completion. The
projector never turns a task or gate green from an inferred result.

## Output Contract

- `governance/ai/core/IMPROVEMENT_BACKLOG.md`: the viewer-compatible series
  table, generated from the approved series manifest.
- `SHARED_PLANNING.md`: the active run's 13 ordered stages with role, status,
  dependencies, and safe artifact references.
- `QUALITY_CHECKLIST.md`: the five owner gates and their factual prerequisite
  status.
- Writes are atomic: a temporary sibling file is renamed only after a complete
  render. The prior valid projection remains visible if input is malformed.

## Execution And Observability

A local supervisor program invokes the projector periodically. It must use the
same project path as the viewer and write concise stdout logs containing only
the run id, source-state timestamp, outcome, and changed/no-change result.
No secret, task instruction body, external identifier, or Telegram data may
enter generated files or logs.

## Failure Behaviour

- Missing series manifest or malformed ledger: exit non-zero, retain previous
  generated files, and log a bounded reason.
- No active Episode 2 ledger: render series backlog and an explicit empty
  active-pipeline state; do not invent a run.
- Unknown status: render `PENDING` with `unknown ledger status`; do not treat
  it as complete.
- Concurrent ledger update: read once, render from that snapshot, and converge
  on the next interval.

## Non-Goals

- No new Kanban UI, database, API, or remote service.
- No changes to `sdtk-wiki` parser/viewer.
- No worker dispatch, task mutation, owner approval, publish, or Telegram
  delivery.
- No generic workflow dashboard in this first slice; this projector is bounded
  to the Build With Proof series and the fixed Episode 2 template.
