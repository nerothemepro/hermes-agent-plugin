# HerWiki Ingest Latest Raw Inbox Tool

Purpose: remove manual `raw_path` copy/paste when HerResearch has already captured a file into the wiki inbox.

This helper finds the newest markdown file in:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox/
```

and returns a ready-to-use HerWiki ingest prompt.

It does **not** ingest the wiki by itself. HerWiki still performs the actual wiki edit step under the wiki `CLAUDE.md` contract.

By default, the helper skips obvious failed captures such as Facebook login screens. Use `--include-problematic` only for debugging.

## CLI

```bash
/workspace/hermes-agent-plugin/bin/herwiki-ingest-latest-raw-inbox
```

Optional:

```bash
/workspace/hermes-agent-plugin/bin/herwiki-ingest-latest-raw-inbox --wiki-root /workspace/sdtk-wiki/ai-agent-second-brain-main
```

Debug mode:

```bash
/workspace/hermes-agent-plugin/bin/herwiki-ingest-latest-raw-inbox --include-problematic
```

## Output

```json
{
  "status": "completed",
  "latest_raw_path": "/workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox/YYYY-MM-DD-....md",
  "skipped_problematic_count": 1,
  "prompt_for_herwiki": "Ingest file raw này vào wiki theo đúng contract ..."
}
```

## Intended Usage

1. HerResearch captures a web/social post into `raw/inbox/`.
2. HerWiki runs this helper to resolve the latest inbox file.
3. HerWiki ingests the returned `latest_raw_path`.

## Recommended HerWiki Prompt

```text
Hãy ingest file raw mới nhất trong raw/inbox vào wiki theo đúng CLAUDE.md.
```
