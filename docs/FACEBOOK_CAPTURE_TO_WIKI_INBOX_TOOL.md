# Facebook Capture To Wiki Inbox Tool

Purpose: standardize the handoff from HerResearch browser extraction to HerWiki ingest.

The tool writes a raw markdown capture into:

```text
/workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox/
```

It does **not** ingest, edit `wiki/`, or mutate existing raw source content. HerWiki remains responsible for the actual wiki ingest workflow under the wiki `CLAUDE.md` contract.

## CLI

```bash
/workspace/hermes-agent-plugin/bin/facebook-capture-to-wiki-inbox --input '{...}'
```

Optional wiki root override:

```bash
/workspace/hermes-agent-plugin/bin/facebook-capture-to-wiki-inbox \
  --input /tmp/facebook-capture.json \
  --wiki-root /workspace/sdtk-wiki/ai-agent-second-brain-main
```

## Input Schema

```json
{
  "source_url": "https://www.facebook.com/groups/.../permalink/...",
  "captured_at": "2026-06-24T03:40:00.000Z",
  "title": "Browser page title",
  "heading": "Main heading",
  "group": "AI Everyday",
  "author": "optional author if visible",
  "post_text": "Extracted post text from Browser Use snapshot/full page",
  "links": ["https://github.com/owner/repo"],
  "screenshot_path": "/optional/path.png",
  "browser_artifacts": ["/optional/path.html"],
  "main_topic": "optional ingest hint",
  "candidate_entities": ["optional entity names"],
  "candidate_concepts": ["optional concept names"],
  "open_questions": ["optional questions"],
  "notes": "optional ingest notes"
}
```

Required field:

- `source_url`

Useful fields:

- `post_text`
- `links`
- `title`
- `heading`
- `group`

The tool also scans URLs inside `post_text` and normalizes GitHub repository URLs to canonical `https://github.com/<owner>/<repo>` form.

## Output Schema

```json
{
  "status": "completed",
  "tool": "facebook-capture-to-wiki-inbox",
  "wiki_root": "/workspace/sdtk-wiki/ai-agent-second-brain-main",
  "raw_path": "/workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox/YYYY-MM-DD-facebook-<slug>.md",
  "source_url": "https://www.facebook.com/groups/...",
  "github_repos": ["https://github.com/owner/repo"],
  "extracted_links_count": 3,
  "captured_at": "2026-06-24T03:40:00.000Z",
  "next_step": "Ask HerWiki to ingest <raw_path>",
  "warnings": [],
  "errors": []
}
```

## HerResearch Prompt

Use this when the user sends a Facebook post URL and wants it prepared for wiki ingest:

```text
Dùng browser tools để mở link Facebook sau:
<FACEBOOK_URL>

Yêu cầu:
1. Không dùng web_search để thay thế nếu browser mở được.
2. Trích xuất page title, heading chính, group/page name nếu thấy được, nội dung bài viết, và toàn bộ link trong bài.
3. Đặc biệt xác định link GitHub repo nếu có.
4. Sau đó dùng terminal chạy helper:

/workspace/hermes-agent-plugin/bin/facebook-capture-to-wiki-inbox --input '<JSON>'

JSON phải có source_url, title, heading, group, post_text, links, screenshot_path/debug_artifacts nếu có.
5. Không ingest wiki.
6. Trả về raw_path, github_repos, warnings/errors.
```

## HerWiki Prompt

After HerResearch returns `raw_path`, ask HerWiki:

```text
Ingest file raw này vào wiki theo đúng /workspace/sdtk-wiki/ai-agent-second-brain-main/CLAUDE.md:
<RAW_PATH>

Yêu cầu:
- giữ raw source immutable
- tạo/update wiki/sources
- nếu có GitHub repo thì tạo/update entity tool tương ứng
- update concept/synthesis liên quan nếu thật sự cần
- append wiki/log.md
- report danh sách file đã thay đổi
```

## Verification

Run tests:

```bash
node --test /workspace/hermes-agent-plugin/test/facebook-capture-to-wiki-inbox.test.js
```

Run a CLI smoke test:

```bash
/workspace/hermes-agent-plugin/bin/facebook-capture-to-wiki-inbox --input '{
  "source_url":"https://www.facebook.com/groups/aieverydayvn/permalink/1312873573587474/",
  "title":"AI Everyday | ktx context layer | Facebook",
  "heading":"AI Everyday",
  "group":"AI Everyday",
  "post_text":"Repo: https://github.com/kartaca/ktx",
  "links":["https://github.com/kartaca/ktx"]
}'
```

If this is only a smoke test, remove the generated raw file from `raw/inbox/` afterward.
