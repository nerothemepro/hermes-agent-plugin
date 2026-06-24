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

## Suggested Telegram Smoke Test

After starting the profile, send:

```text
Mày đang là HerWiki. Hãy đọc /workspace/sdtk-wiki/ai-agent-second-brain-main/CLAUDE.md và wiki/index.md, sau đó trả lời ngắn gọn:
- vai trò của mày là gì
- raw/ có được sửa nội dung không
- khi query wiki thì cần cite như thế nào
Không chỉnh sửa file.
```

Expected result: HerWiki answers from the wiki contract and does not edit files.

## Ingest Quality Gate

For captured web/social material, HerWiki must not infer missing metadata. It must preserve raw provenance, label unknown fields as `not captured`, append `wiki/log.md`, and check edited files for mojibake before reporting completion.
