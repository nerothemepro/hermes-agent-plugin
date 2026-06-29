# Hermes Agent Fork Governance Runbook

Date: 2026-06-29
Scope: govern the local `hermes-agent` shortcut patch through a Nero-controlled fork

## Purpose

This runbook documents how the local `hermes-agent` divergence is governed so the Hermes multi-bot stack can be rebuilt later without depending on hidden local edits.

## Upstream And Fork

Upstream source:

- `https://github.com/NousResearch/hermes-agent`

Nero-controlled fork:

- `https://github.com/nerothemepro/hermes-agent`

Current governed branch:

- `feature/herorches-shortcuts-governance`

## Governed Patch Scope

The governed patch for this phase is intentionally narrow.

Included files:

- `gateway/run.py`
- `hermes_cli/commands.py`
- `tests/gateway/test_unknown_command.py`
- `tests/hermes_cli/test_commands.py`

These changes provide:

- Telegram command registry entries for HerOrches shortcuts
- Telegram command registry entries for HerSocial shortcuts
- background-routing behavior for shortcut commands
- tests that prove registry exposure and background rewrite behavior

## Explicit Exclusions

These local changes are not part of the governed fork patch for Phase 2:

- `orchestrate.py`
- `plugins/local_media/tools.py`
- `.playwright-mcp/`
- `plugins/local_media/tools.py.bak.quality-default-20260608-015009`

Why excluded:

- they are application/runtime-specific changes, not Hermes core shortcut-governance changes
- they would widen the fork scope and make future upstream sync harder
- backup and runtime artifact files must not become source-of-truth code

## Verification Evidence Used For The Governed Branch

Targeted tests run from `/workspace/hermes-agent` using `/workspace/.venvs/hermes-agent/bin/python`:

```bash
/workspace/.venvs/hermes-agent/bin/python -m pytest tests/gateway/test_unknown_command.py -k 'shortcut or known_slash_command_not_flagged_as_unknown'
/workspace/.venvs/hermes-agent/bin/python -m pytest tests/hermes_cli/test_commands.py -k 'social_shortcuts_appear_when_quick_commands_are_configured or herorches_shortcuts_appear_when_quick_commands_are_configured'
```

Observed result:

- gateway shortcut tests passed
- command registry tests passed

Governed branch commit created locally:

- `e0359321d` — `Add governed Telegram shortcut commands`

## Current Remote State

The governed branch has been pushed to the fork:

- `nerothemepro/hermes-agent`
- branch: `feature/herorches-shortcuts-governance`

Suggested review URL:

- `https://github.com/nerothemepro/hermes-agent/pull/new/feature/herorches-shortcuts-governance`

## Recommended Promotion Strategy

Preferred order:

1. Keep the governed patch on the feature branch first.
2. Validate the live Hermes environment against the fork branch if needed.
3. Promote to the fork default branch only after confirming no missing hidden dependencies remain.

Why this is safer:

- the local checkout still contains unrelated out-of-scope changes
- branch-first keeps the governed shortcut patch reviewable and reversible

## Future Upstream Sync Workflow

### 1. Fetch both remotes

```bash
git fetch origin
git fetch nerothemepro
```

### 2. Compare upstream and governed branch

```bash
git log --oneline --left-right origin/main...nerothemepro/feature/herorches-shortcuts-governance
```

### 3. Rebase governed branch onto upstream main

```bash
git switch feature/herorches-shortcuts-governance
git rebase origin/main
```

If conflicts appear, resolve only within the governed shortcut files unless scope is intentionally expanded.

### 4. Re-run governed tests

```bash
/workspace/.venvs/hermes-agent/bin/python -m pytest tests/gateway/test_unknown_command.py -k 'shortcut or known_slash_command_not_flagged_as_unknown'
/workspace/.venvs/hermes-agent/bin/python -m pytest tests/hermes_cli/test_commands.py -k 'social_shortcuts_appear_when_quick_commands_are_configured or herorches_shortcuts_appear_when_quick_commands_are_configured'
```

### 5. Push updated governed branch

```bash
git push nerothemepro feature/herorches-shortcuts-governance
```

If the branch was rebased after it had already been shared, use force-with-lease instead of plain force:

```bash
git push --force-with-lease nerothemepro feature/herorches-shortcuts-governance
```

## Rollback Strategy

If the governed branch is found to break shortcut behavior:

1. stop using the governed branch as deployment source
2. compare current local behavior against the branch diff
3. identify whether missing logic lives in an excluded file
4. either:
   - patch the governed branch deliberately, or
   - keep the missing change out of scope and document why the fork remains branch-only for now

## Operator Notes

- Keep `origin` pointing at Nous upstream.
- Keep the Nero-controlled fork as a separate remote, not a replacement for upstream.
- Do not commit runtime browser artifacts, backup files, or local pipeline tweaks into the fork as part of shortcut governance.
