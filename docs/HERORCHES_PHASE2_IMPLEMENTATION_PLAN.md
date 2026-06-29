# HerOrches Phase 2 Implementation Plan

Date: 2026-06-29
Phase: Hermes Core Patch Governance
Status: Draft for approval
Next skill after approval: `sdtk-code-execute`

## Scope Summary

This phase moves the current local `hermes-agent` core shortcut patch from an undocumented local divergence into a reproducible, user-controlled fork workflow.

Target outcome:

- the HerOrches and HerSocial Telegram shortcut behavior is preserved in a Nero-controlled `hermes-agent` fork
- the current local divergence is audited and reduced to an intentional patch set
- unrelated local modifications are explicitly excluded from the fork-governance scope
- operators can rebuild the stack later without depending on hidden local edits inside `/workspace/hermes-agent`

This phase governs the patch. It does not expand operator commands beyond the already-approved shortcut set.

Acceptance boundary for Phase 2:

- local divergence is classified into in-scope vs out-of-scope changes
- target fork workflow is documented
- shortcut patch and related tests are committed to a user-controlled `hermes-agent` fork
- a rebase/sync runbook exists for future upstream updates
- the local environment can be pointed at the governed fork instead of relying on undocumented manual edits

## Existing Baseline

Current upstream remote for local `hermes-agent` checkout:

- `origin = https://github.com/NousResearch/hermes-agent.git`

Current local modified tracked files:

- `gateway/run.py`
- `hermes_cli/commands.py`
- `orchestrate.py`
- `plugins/local_media/tools.py`
- `tests/gateway/test_unknown_command.py`
- `tests/hermes_cli/test_commands.py`

Current untracked/local artifacts:

- `.playwright-mcp/`
- `plugins/local_media/tools.py.bak.quality-default-20260608-015009`

Audit conclusion:

### In-scope patch candidates for Phase 2 fork governance

These look directly related to Telegram shortcut and command-registry behavior:

- `gateway/run.py`
- `hermes_cli/commands.py`
- `tests/gateway/test_unknown_command.py`
- `tests/hermes_cli/test_commands.py`

### Out-of-scope or suspicious local changes that should not be blindly folded into the fork

These require separate decision or exclusion:

- `orchestrate.py`
  - local LM Studio URL normalization
  - polling timeout/retry behavior
  - mode override semantics for preview pipeline
- `plugins/local_media/tools.py`
  - local media wording/behavior change unrelated to shortcut governance
- `.playwright-mcp/`
  - runtime browser artifacts/logs, not source-of-truth code
- `plugins/local_media/tools.py.bak.quality-default-20260608-015009`
  - backup artifact, not source

## Dependency Notes

- Depends on a Nero-controlled GitHub repository for the `hermes-agent` fork
- Depends on preserving upstream Nous history so future rebase/sync remains possible
- Depends on keeping the current shortcut behavior test-backed before any cleanup or patch extraction
- Depends on not accidentally mixing application-specific pipeline changes into the governance patch

## Task List In Execution Order

### 1. Freeze and classify the local divergence

Purpose:

- create a precise inventory of which local changes belong to shortcut governance and which do not

Files likely to change:

- `docs/HERORCHES_PHASE2_IMPLEMENTATION_PLAN.md`
- optional audit notes in docs if split into a dedicated artifact

Verification:

- `git -C /workspace/hermes-agent diff --name-only`
- inspect diffs for the six tracked modified files
- confirm which files are in scope for the fork

Rollback / containment:

- no code mutation yet; if classification is ambiguous, stop and keep the plan at audit stage

### 2. Define fork boundary and exclusion policy

Purpose:

- prevent unrelated local pipeline changes from contaminating the `hermes-agent` fork

Files likely to change:

- `docs/HERORCHES_PHASE2_IMPLEMENTATION_PLAN.md`
- `docs/BACKLOG.md` if status wording needs update

Verification:

- explicit in-scope list contains only command-registry/shortcut/test files
- explicit exclusion list captures `orchestrate.py`, `plugins/local_media/tools.py`, `.playwright-mcp/`, and backup artifacts

Rollback / containment:

- if any excluded file later proves necessary for shortcut behavior, reopen the audit before touching the fork

### 3. Create or connect the Nero-controlled fork remote

Purpose:

- move from upstream-only local state to a reproducible governed fork

Files likely to change:

- local git remote configuration in `/workspace/hermes-agent`
- fork/runbook docs in `hermes-agent-plugin`

Verification:

- `git -C /workspace/hermes-agent remote -v`
- confirm upstream remote remains readable
- confirm fork remote exists and is writable

Rollback / containment:

- keep upstream remote untouched
- if fork creation/auth fails, stop before rewriting any branch state

### 4. Commit only the governed shortcut patch into the fork branch

Purpose:

- isolate the command-registry behavior as a clean patch set

Files likely to change:

- `gateway/run.py`
- `hermes_cli/commands.py`
- `tests/gateway/test_unknown_command.py`
- `tests/hermes_cli/test_commands.py`

Verification:

- diff against upstream contains only the governed files
- tests for command registry and shortcut rewrite behavior pass

Rollback / containment:

- use a dedicated branch in the fork first
- do not include unrelated modified files in the commit

### 5. Decide disposition of out-of-scope local changes

Purpose:

- remove ambiguity around `orchestrate.py` and `plugins/local_media/tools.py`

Files likely to change:

- none in fork if deferred
- documentation notes if these are intentionally kept outside Phase 2

Verification:

- written decision for each excluded change:
  - migrate elsewhere
  - keep local only temporarily
  - discard after separate validation

Rollback / containment:

- keep excluded files uncommitted to the fork until separately approved

### 6. Write upstream sync / rebase runbook

Purpose:

- make future maintenance explicit for internal operators

Files likely to change:

- new or updated docs in `hermes-agent-plugin/docs/`
  - likely a dedicated fork governance runbook

Verification:

- runbook covers:
  - upstream fetch
  - branch compare
  - rebase or merge policy
  - test commands after sync
  - rollback path if shortcut behavior breaks

Rollback / containment:

- if rebase workflow is not yet stable, document a conservative merge-forward policy first

## Architecture Review Notes

### Data flow boundaries

- `hermes-agent` fork owns Hermes core Telegram shortcut behavior
- `hermes-agent-plugin` owns profile packaging, host automation, runbooks, and media-specific tools
- runtime artifacts such as `.playwright-mcp` logs are not part of either governed source package

### State transitions

Important lifecycle states:

- local undocumented divergence on top of upstream Nous
- divergence classified and narrowed
- governed patch committed into fork branch
- fork becomes source of truth for rebuilds
- future upstream syncs happen against a documented process

### Dependency graph risks

- shortcut logic is split across `gateway/run.py` and `hermes_cli/commands.py`
- tests must move with behavior or the fork will regress silently
- mixing `orchestrate.py` and local media patches into the fork would widen governance scope incorrectly

### Performance / operational hotspots

- low runtime risk; this phase is mostly governance and reproducibility
- highest risk is operational confusion if source-of-truth remains split across multiple repos and local dirty files

### Observability coverage

Minimum operator signals needed:

- clean `git diff` classification
- explicit fork remote visibility
- passing shortcut-related tests
- Telegram `/commands` or shortcut behavior still working after switching to governed source

## Happy / Missing / Empty / Error Path Review

### Happy path

- fork repo exists
- governed files are isolated cleanly
- tests pass
- patch is pushed to fork
- runbook documents future sync work

### Missing-input path

- target fork repo URL not provided yet
- planning can finish, execution stops before remote mutation

### Empty / no-op path

- no additional shortcut diff beyond the four governed files
- phase still succeeds by documenting and pushing only that minimal patch

### Error path

- local changes are more entangled than expected
- tests fail after isolating the patch
- fork remote auth fails
- upstream history mismatch complicates clean branch creation

## Observable State Notes

### Task 3-4 — fork and commit flow

Customer sees:

- usually nothing directly; this is internal governance work

Operator sees:

- git remotes
- branch history
- clean diff boundaries
- test output

Database:

- none

Logs:

- git command output
- test runner output

### Task 6 — future maintenance runbook

Customer sees:

- more stable rebuild and upgrade behavior later

Operator sees:

- explicit instructions instead of tribal knowledge

Database:

- none

Logs:

- documentation only

## Assumptions

| # | Assumption | Verified | Risk if wrong |
|---|---|---|---|
| A1 | The governed shortcut patch can be isolated to four source/test files without pulling unrelated runtime/tool changes. | No | High |
| A2 | Nero will provide or create a writable GitHub fork target for `hermes-agent`. | No | High |
| A3 | Upstream Nous `hermes-agent` history is still a suitable base for the fork. | No | Medium |
| A4 | The untracked `.playwright-mcp/` directory is runtime artifact only and should not be versioned in the fork. | No | Low |
| A5 | `orchestrate.py` and `plugins/local_media/tools.py` changes are outside the shortcut governance scope for this phase. | No | Medium |

## Open Questions

- What exact GitHub repo URL should be used for the `hermes-agent` fork?
- Should the fork branch become the new deployment source immediately, or only after a side-by-side verification pass?
- Do you want `orchestrate.py` and `plugins/local_media/tools.py` handled in a later separate phase, or should they be explicitly reverted locally after the governed fork is established?

## Not In Scope

- adding new HerOrches commands beyond the currently working set
- redesigning HerSocial or HerVid workflows
- packaging the full stack for external operator migration documentation
- replacing the current host/container runtime architecture

## Verification Checklist

1. Audit local divergence:
   - `git -C /workspace/hermes-agent diff --name-only`
2. Confirm in-scope governed files only:
   - `git -C /workspace/hermes-agent diff -- gateway/run.py hermes_cli/commands.py tests/gateway/test_unknown_command.py tests/hermes_cli/test_commands.py`
3. Confirm excluded local changes explicitly:
   - `git -C /workspace/hermes-agent diff -- orchestrate.py plugins/local_media/tools.py`
   - inspect `.playwright-mcp/`
   - inspect backup artifact presence
4. Create/connect fork remote and verify:
   - `git -C /workspace/hermes-agent remote -v`
5. Run shortcut-related tests after isolating the patch:
   - command tests
   - gateway shortcut rewrite tests
6. Verify Telegram shortcut behavior still matches current operator workflow after switching to the governed source

## Proposed Execution Order After Approval

1. Create/connect the fork remote.
2. Isolate governed patch files in a dedicated branch.
3. Run shortcut-related tests.
4. Push governed patch into the fork.
5. Write the sync/rebase maintenance runbook.
6. Decide follow-up handling for excluded local changes.
