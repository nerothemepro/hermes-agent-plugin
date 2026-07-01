# HerWiki SDTK-WIKI Shortcuts

Purpose: give `herwiki` deterministic Telegram slash commands for the fixed local wiki workspace at:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main
```

These shortcuts are meant to reduce ambiguity for common `sdtk-wiki` operations and avoid ad hoc shell construction by the model.

## Commands

### `/wiki-ingest`

Runs:

```bash
sdtk-wiki ingest /workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox --project-path /workspace/sdtk-wiki/ai-agent-second-brain-main
```

Behavior:

- deterministic
- report-first
- updates semantic extraction reports only
- no direct wiki page mutation

### `/wiki-compile`

Runs:

```bash
sdtk-wiki compile --mode safe --project-path /workspace/sdtk-wiki/ai-agent-second-brain-main
```

Behavior:

- safe preview only
- no `--apply`
- returns changed report paths

### `/wiki-lint`

Runs:

```bash
sdtk-wiki lint --project-path /workspace/sdtk-wiki/ai-agent-second-brain-main
```

Behavior:

- report-first lint
- no wiki/source mutation

### `/wiki-maintain`

Runs:

```bash
sdtk-wiki maintain --mode safe --project-path /workspace/sdtk-wiki/ai-agent-second-brain-main
```

Behavior:

- safe maintenance cycle
- no apply/delete/archive/web fetch

### `/wiki-discover`

Runs:

```bash
sdtk-wiki discover --plan --project-path /workspace/sdtk-wiki/ai-agent-second-brain-main
```

Behavior:

- local-only discovery planning
- no ingest/compile/apply/web fetch

### `/wiki-search <query>`

Runs:

```bash
sdtk-wiki search --project-path /workspace/sdtk-wiki/ai-agent-second-brain-main --json --limit 10 "<query>"
```

Behavior:

- read-only deterministic search
- no Ask / no LLM / no web

## Helper CLI

Repo-managed helper:

```bash
/workspace/hermes-agent-plugin/bin/herwiki-sdtk-wiki-tool
```

Examples:

```bash
/workspace/hermes-agent-plugin/bin/herwiki-sdtk-wiki-tool ingest
/workspace/hermes-agent-plugin/bin/herwiki-sdtk-wiki-tool lint
/workspace/hermes-agent-plugin/bin/herwiki-sdtk-wiki-tool search --query "multi-agent"
```

## Output Contract

All shortcuts return JSON with a stable shape similar to:

```json
{
  "status": "completed",
  "action": "lint",
  "wiki_root": "/workspace/sdtk-wiki/ai-agent-second-brain-main",
  "report_dir": "/workspace/sdtk-wiki/ai-agent-second-brain-main/.sdtk/wiki/reports",
  "command": ["sdtk-wiki", "lint", "--project-path", "..."],
  "report_paths": [],
  "warnings": [],
  "errors": []
}
```

For `wiki-search`, the payload also includes:

- `query`
- `limit`
- `search_results` (compact top-match list, not the full raw search JSON)
- `result_count`
- `total_matches`
- `search_meta`

Notes:
- `report_paths` is now sanitized to remove blank entries.
- `wiki-search` intentionally returns a compact deterministic summary so Telegram replies do not explode into oversized multi-part JSON as easily.

## Operator Guidance

- Prefer these shortcuts instead of natural-language requests when the goal is a known `sdtk-wiki` verb.
- `wiki-ingest` here means **toolkit ingest/extraction**, not the older manual HerWiki page-edit workflow.
- If the operator wants actual wiki page changes from compile apply plans, handle that as a separate explicit workflow.
