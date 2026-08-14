# EP2 Kanban Projector - Implementation Plan

## Scope

Implement the read-only projection described in
`EP2_KANBAN_PROJECTOR_CONTROLLER_SPEC.md`. The implementation lives in
`nerothemepro/hermes-agent-plugin` and is deployed separately from the running
EP2 workflow.

## Tasks

1. Add a versioned series manifest under `control-plane/ep2-kanban/` containing
   the owner-locked ten episodes, their titles, CTA routes, and initial status.
   The manifest contains no copy payloads, credentials, or publishing state.
   Verification: schema validation in a focused Node test.

2. Add a dependency-free Node projector under `control-plane/ep2-kanban/`.
   It accepts explicit `--project-path`, `--run-id`, and `--series-manifest`
   arguments; reads the ledger snapshot; maps status deterministically; and
   atomically writes the three viewer-compatible Markdown files. Its default
   remains dry and local: it does not start workers or contact a network.
   Verification: fixture-led tests for created, external-running,
   waiting-for-approval, completed, failed, missing, and unknown states.

3. Add generated-file headers and an operator README that documents the
   canonical sources, status map, manual one-shot invocation, recovery rules,
   and the boundary that users must not hand-edit projection outputs.
   Verification: fixture output includes the viewer-required headers and
   tables.

4. Add a small supervisor wrapper and `hermes-ep2-kanban-projector.conf`.
   The wrapper runs only the projector against `/workspace/hermes-agent-plugin`
   and `run_mssff5si_c0bf25`, sleeps for a bounded interval, and forwards
   SIGTERM. It has no tunnel, no secrets, and no external side effects.
   Verification: wrapper `--once` and config-path tests; existing supervisor
   config inclusion is checked without starting/restarting any service.

5. Add regression tests that prove the projector never writes beneath
   `.sdtk/agent-runtime/runs`, never changes the series manifest, and never
   maps unknown/failed input to `DONE`.
   Verification: run the focused projector test suite plus existing control
   plane template tests.

6. Commit the source change and open a PR to
   `nerothemepro/hermes-agent-plugin`. The PR report includes tests and a
   deployment packet. Runtime deployment remains an owner-authorized, narrow
   follow-up after review/merge.

## Data Flow

`series manifest + ledger state.json` -> projector snapshot -> atomic Markdown
projection -> existing `sdtk-wiki kanban` API -> existing viewer/tunnel.

The ledger and manifest are read-only inputs. The three root Markdown files are
derived outputs, not input state.

## Error And Recovery Paths

| Path | Behaviour |
|---|---|
| Valid active run | Render backlog, pipeline, and quality projection. |
| No ledger yet | Render backlog plus explicit no-active-run state. |
| Malformed input | Preserve the last valid generated files and exit non-zero. |
| Unknown status | Display `PENDING`; never display `DONE`. |
| Process restart | Re-read canonical inputs; no replay or mutation is needed. |

## Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | Installed SDTK-WIKI reads root `SHARED_PLANNING.md` and `QUALITY_CHECKLIST.md`, plus the root improvement backlog. | Yes | Low |
| A2 | The active EP2 ledger stays under the plugin project path. | Yes | Low |
| A3 | The supervisor runtime can execute Node already used by the control-plane scripts. | Yes | Low |
| A4 | The owner-approved R2 order is the canonical series ordering. | Yes | Low |

## Out Of Scope

- Retrofitting prior Hermes Kanban board data into this viewer.
- Editing the product repository or the SDTK-WIKI package.
- Automatic next-episode creation, dispatch, approval, or publishing.
- Public tunnel persistence or authentication changes.

## Verification Checklist

- Projector tests cover every ledger mapping and malformed input retention.
- Generated Markdown is parseable by the installed Kanban parser fixtures.
- Existing `hermesControlPlane` and `hermesControlPlanePrepare` tests remain
  green.
- `git diff --check` passes.
- No test or fixture contains a token, home chat id, task instruction body, or
  social payload.
