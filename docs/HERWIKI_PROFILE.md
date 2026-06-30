# HerWiki Hermes Profile

Purpose: maintain Nero's markdown-first personal knowledge base at `/workspace/sdtk-wiki/ai-agent-second-brain-main`.

Model: `google/gemma-4-26b-a4b-qat`

Recommended LM Studio context: `65536`

Primary tools:

- `clarify`
- `messaging`
- `terminal`
- `file`
- `search`

## Persistent Bootstrap Contract

HerWiki must not depend on prior chat history.

At the start of every fresh session, and after `/new` or `/reset`, it must re-read:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main/CLAUDE.md
/workspace/sdtk-wiki/ai-agent-second-brain-main/wiki/index.md
```

For latest raw inbox ingest flows, it should also use:

```text
/workspace/hermes-agent-plugin/docs/HERWIKI_INGEST_LATEST_RAW_INBOX_TOOL.md
```

Do not use HerWiki for:

- video generation
- browser automation / web booking
- general coding tasks outside wiki maintenance
- customer translation/email drafting

Use the dedicated profiles for those jobs:

- `hervid`: video generation
- `herresearch`: web research/browser/search
- `herdev`: coding and SDTK implementation
- `hertran`: Japanese/English/Vietnamese PM communication

## Wiki Root

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main
```

## Runtime Identity

The live profile must include:

```text
/opt/data/hermes-profiles/herwiki/SOUL.md
```

The source copy is:

```text
/workspace/hermes-agent-plugin/docs/HERWIKI_SOUL.md
```

## Operating Contract

HerWiki must read and follow:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main/CLAUDE.md
```

Key rules:

- `raw/` is immutable source material.
- `wiki/` is the compiled editable layer.
- `workspace/` is scratch/export only.
- meaningful changes must be appended to `wiki/log.md`.
- query answers must be grounded in wiki pages and cite paths.
- ingestion must preserve source provenance.
