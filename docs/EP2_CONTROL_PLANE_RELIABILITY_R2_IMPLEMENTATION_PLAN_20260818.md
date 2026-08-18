# EP2 Control-Plane Reliability R2

## Objective
Make EP2 render dispatch depend on a board-local, spawnable Hermes profile and canonical capture evidence. Never depend on a worker scratch directory after capture completes.

## Root-Cause Evidence
- The profile alias allows `hermes -p hervid` but changes implicit Kanban resolution to `/opt/data/hermes/kanban.db`. The EP2 card remains in `/opt/data/hermes-profiles/hervid/kanban.db`.
- The completed capture referenced a scratch workspace that no longer exists, so its previous asset paths cannot be verified or handed off.

## Implementation
1. Pin `HERMES_KANBAN_HOME` to each role profile home in EP2 runtime maps.
2. Require product-capture workers to write DEMO-only, hash-listed assets directly to the canonical run artifact directory before completion.
3. Validate the canonical manifest in the controller and deliver its SHA to the existing render card only after successful validation.
4. Preserve the existing run as evidence-invalid. Do not dispatch its render card. Prepare a new capture attempt only through a later owner-confirmed recovery command.

## Acceptance
- A profile alias plus board pin can show the original local card and dry-run dispatch without `skipped_nonspawnable`.
- Canonical capture validation succeeds after the scratch workspace is absent.
- Missing canonical assets fail closed.
- No automatic capture or render dispatch occurs during deployment.

## Verification Evidence
- `node --test control-plane/video-dogfood/test-controller.js test/hermesControlPlane.test.js` -> 21 pass, 0 fail.
- `bash -n scripts/deploy_ep2_hervid_profile_alias.sh` -> exit 0.
- `git diff --check` -> exit 0.
