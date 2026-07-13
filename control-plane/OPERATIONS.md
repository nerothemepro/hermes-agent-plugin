# Phase A Operator Commands

`hermes-control-plane` validates and previews fixed templates without dispatch.

`hermes-control-plane-prepare` performs the one permitted mutation before owner
dispatch approval: it creates an SDTK ledger run and a reference-only record at
`/opt/data/hermes/control-plane/runs/<run_id>.json`.

The registry record contains only the run id, template id/version/digest, and
paths to the SDTK ledger, state file, and canonical final report. It is not a
copy of state and is never a source of truth. The SDTK ledger remains canonical.

Example for the approved smoke scope:

```bash
node bin/hermes-control-plane preview --template site_audit --params '{}'
node bin/hermes-control-plane-prepare --template site_audit --params '{}'
```

The second command must be followed by a stop. An operator waits for the exact
owner command printed by the helper, such as `APPROVE DISPATCH run_example`.
The helper has no dispatch command, so it cannot bypass that approval boundary.
