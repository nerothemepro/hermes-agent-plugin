# Hermes Control Plane MVP - Phase A

Phase A provides reviewed, fixed workflow templates. It is an attended operator
surface, not a Telegram command router and not a general workflow authoring API.

## Template bundles

Each bundle lives in `control-plane/templates/<template-id>/template.json` and
pins its workflow, runtime map, allowed profile, deadline, instructions, side
effects, cleanup policy, and strict parameter schema.

The fixed templates are:

- `site_audit` -> `herresearch`
- `research_brief` -> `herresearch`
- `status` -> `herorches`
- `marketing_video_ep_usage` -> fixed attended multi-profile Episode 2 workflow

Templates remain fixed and attended. Existing research/status templates are read-only. The Episode 2 template permits only the bounded local capture/render and checked social-preparation stages stated in its manifest; it never publishes, auto-approves, or accepts free-form workflow JSON.

## Operator commands

```bash
node bin/hermes-control-plane validate --template site_audit
node bin/hermes-control-plane preview --template site_audit --params '{}'
node bin/hermes-control-plane preview --template research_brief --params '{"topic":"Hermes Kanban lifecycle"}'
node bin/hermes-control-plane preview --template status --params '{"run_id":"run_mrexaq5m_4b7d0c"}'
node bin/hermes-control-plane validate --template marketing_video_ep_usage
```

`preview` is read-only. It validates and renders only in memory, then reports
the profile, task/gate/dispatch counts, deadline, cost band, and the exact
approval form required before a run may be prepared and dispatched.

`prepare` is intentionally not a dispatch operation. It creates an SDTK ledger
run with `sdtk-agent run start`, then writes a reference-only registry record
under `/opt/data/hermes/control-plane/runs/<run_id>.json`. The SDTK ledger and
its canonical `reports/final_report.md` remain the sole source of truth.

The registry record may contain only run/task identifiers and absolute ledger
or report paths plus digests. It must never contain a token, cookie, workflow
state copy, raw task body, or environment value.

## Approval and execution boundary

The Phase A CLI does not dispatch a Hermes worker. The operator must show the
prepared run and wait for an exact owner approval:

```text
APPROVE DISPATCH <run_id>
```

Only after that exact approval may the audited `sdtk-agent run continue
--confirm` path be used. Telegram parsing and durable monitoring belong to
Phases B and C, not this implementation.
