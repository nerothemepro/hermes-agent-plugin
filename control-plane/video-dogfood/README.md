# Controller-led Video Dogfood Mode

This mode is the temporary control surface for EP2, EP3, and EP4. SDTK-AGENT
remains the canonical workflow ledger. Native Hermes Kanban cards remain worker
transport. SDTK-WIKI Kanban remains a read-only projection.

The owner confirms one run kickoff, then retains exactly three gates:

1. Story Lock
2. Picture Lock
3. Publish Approval

External publishing is not part of this controller. It remains attended and
exact-SHA-gated through the existing publisher.

## Controller commands

```bash
node control-plane/video-dogfood/controller.js inspect --run-id <run_id>
node control-plane/video-dogfood/controller.js next --run-id <run_id>
node control-plane/video-dogfood/controller.js reconcile --run-id <run_id>
node control-plane/video-dogfood/controller.js continue --run-id <run_id> --confirm
```

`continue --confirm` is used only after the owner has reviewed the workflow
preview and confirmed kickoff for that run. The helper reports its preflight and
invokes one SDTK continue. It cannot approve gates or publish.

Tool defects are separate from run state:

```bash
node control-plane/video-dogfood/controller.js defect record \
  --defect-id DEF-EP2-001 --title "Blocked run reused" --severity P1 \
  --run-id <run_id> --task-id script_package \
  --blocker-class TOOL_DEFECT --next-action "Fix terminal semantics"

node control-plane/video-dogfood/controller.js defect close \
  --defect-id DEF-EP2-001 --verification "node --test: all pass"
```

The defect ledger is mode 0600 under
`.sdtk/video-dogfood/defects.json`. It never overrides canonical run state.

## Recovery policy

- Worker content gets one precise correction attempt.
- A completed native card may be reconciled once.
- A tool defect is fixed and tested in the staging toolchain.
- Architecture defects and external mutations stop for owner review.
- No retry may create a duplicate native card or social upload.

## Staging

Use reviewed local package tarballs with the scripts in `staging/`. Install
creates an immutable release directory. Activate writes one mode-0600 pointer.
Activating the prior verified release is rollback. Historical releases are
never deleted automatically.

Supervisor wrappers may invoke commands through:

```text
control-plane/video-dogfood/staging/with-active-toolchain.sh <command> [args...]
```

Do not change production package versions during an episode. Promote one tested
batch only after episode closure.
