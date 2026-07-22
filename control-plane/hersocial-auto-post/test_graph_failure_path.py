from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from test_hersocial_auto_post_runner import FakeFacebook, load_module


class ReconcileFailureFacebook(FakeFacebook):
    def __init__(self, module):
        super().__init__()
        self.module = module

    def find_exact_post(self, message):
        raise self.module.GraphFailure("graph_http_401")


class GraphFailurePathTest(unittest.TestCase):
    def test_reconcile_failure_is_terminal_sanitized_and_reported(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            posts = root / "posts"
            posts.mkdir()
            media = root / "asset.png"
            media.write_bytes(b"image")
            manifest = {
                "schema_version": "hersocial.facebook-post.v1",
                "post_key": "post-graph-failure",
                "status": "approved",
                "scheduled_at": "2026-07-23T09:00:00+09:00",
                "max_lateness_minutes": 60,
                "message": "Approved post",
                "first_comment": "Approved comment",
                "media_path": str(media),
                "media_kind": "image",
                "source_document": "governance/marketing/post.md",
                "approval": {"approved_by": "owner", "approved_content_sha256": "pending"},
            }
            manifest["approval"]["approved_content_sha256"] = module.content_digest(manifest)
            (posts / "post.json").write_text(json.dumps(manifest), encoding="utf-8")
            deliveries = []
            runner = module.HerSocialAutoPostRunner(
                posts_dir=posts,
                state_path=root / "state.json",
                facebook=ReconcileFailureFacebook(module),
                notifier=deliveries.append,
                now=lambda: datetime(2026, 7, 23, 0, 0, tzinfo=timezone.utc),
                enabled=True,
            )

            result = runner.run_once()

            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["reason"], "facebook_reconcile_failed")
            self.assertEqual(deliveries, ["HerSocial auto-post FAILED: post-graph-failure"])
            self.assertNotIn("401", deliveries[0])


if __name__ == "__main__":
    unittest.main()
