# Facebook Batch Capture To Wiki Inbox Tool

Purpose: make HerResearch batch Facebook capture deterministic.

The single-link helper writes one raw markdown file. This batch helper accepts the result of multiple browser attempts, writes raw files only for links that were actually captured, and reports blocked/login-wall links in `failed[]`.

It prevents two common agent errors:

- Reporting guessed `raw_path` values such as "expected" or "dự kiến".
- Writing Facebook login pages into the wiki inbox as if they were real source captures.

## CLI

```bash
/workspace/hermes-agent-plugin/bin/facebook-batch-capture-to-wiki-inbox --input /tmp/facebook-batch.json
```

Inline JSON is also supported:

```bash
/workspace/hermes-agent-plugin/bin/facebook-batch-capture-to-wiki-inbox --input '{"items":[...]}'
```

Optional wiki root override:

```bash
/workspace/hermes-agent-plugin/bin/facebook-batch-capture-to-wiki-inbox \
  --input /tmp/facebook-batch.json \
  --wiki-root /workspace/sdtk-wiki/ai-agent-second-brain-main
```

## Input Schema

```json
{
  "items": [
    {
      "source_url": "https://www.facebook.com/groups/.../permalink/...",
      "status": "captured",
      "captured_at": "2026-06-24T08:00:00.000Z",
      "title": "Browser page title",
      "heading": "Main heading",
      "group": "AI Everyday",
      "author": "optional author if visible",
      "post_text": "Actual post/comment text",
      "links": ["https://github.com/owner/repo"],
      "browser_artifacts": ["/optional/debug.html"]
    },
    {
      "source_url": "https://www.facebook.com/reel/...",
      "status": "login_required",
      "reason": "Facebook login wall"
    }
  ]
}
```

Captured statuses:

- `captured`
- `completed`
- `success`
- `ok`

Blocked/error statuses:

- `login_required`
- `blocked`
- `not_accessible`
- `not_found`
- `browser_error`
- `error`
- `skipped`

If an item says `captured` but contains Facebook login text, the helper treats it as `login_required`.

If an item says `captured` but has no usable `post_text` or links, the helper treats it as `empty_capture`.

## Output Schema

```json
{
  "status": "completed",
  "tool": "facebook-batch-capture-to-wiki-inbox",
  "wiki_root": "/workspace/sdtk-wiki/ai-agent-second-brain-main",
  "total_count": 2,
  "completed_count": 1,
  "failed_count": 1,
  "completed": [
    {
      "index": 0,
      "url": "https://www.facebook.com/groups/...",
      "raw_path": "/workspace/sdtk-wiki/ai-agent-second-brain-main/raw/inbox/2026-06-24-facebook-github-owner-repo.md",
      "github_repos": ["https://github.com/owner/repo"],
      "extracted_links_count": 1,
      "warnings": []
    }
  ],
  "failed": [
    {
      "index": 1,
      "url": "https://www.facebook.com/reel/...",
      "reason": "login_required",
      "detail": "Facebook login wall"
    }
  ],
  "warnings": ["1 link(s) were not captured. See failed[]."],
  "errors": []
}
```

When no links are captured, `status` is `blocked` and no raw files are created.

## Recommended HerResearch Batch Prompt

Use this prompt when the user sends multiple Facebook links:

```text
Dùng browser mở tối đa 4 link Facebook dưới đây.

Với mỗi link:
1. Nếu thấy Facebook Login / login wall / không đọc được nội dung post/comment thì thêm item:
   {"source_url":"<url>","status":"login_required","reason":"Facebook login wall"}
   Không tự suy đoán nội dung.
2. Nếu đọc được nội dung bài/comment, trích xuất title, heading, group/page, author nếu thấy, post_text, toàn bộ links, đặc biệt GitHub repo trong comment.
   Thêm item với status="captured".
3. Sau khi xử lý hết các link trong batch, tạo JSON {"items":[...]} và chạy:
   /workspace/hermes-agent-plugin/bin/facebook-batch-capture-to-wiki-inbox --input '<JSON>'
4. Report đúng JSON stdout của helper: completed[].raw_path, completed[].github_repos, failed[].
5. Không ingest wiki. Không ghi "dự kiến". Không tự tạo raw_path.
```

For large lists, split into batches of 3-5 links to avoid context/tool-call exhaustion.

## Verification

```bash
node --test /workspace/hermes-agent-plugin/test/facebook-batch-capture-to-wiki-inbox.test.js
```
