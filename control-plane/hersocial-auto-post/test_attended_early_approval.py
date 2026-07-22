from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from test_hersocial_auto_post_runner import FakeFacebook


def load_module():
    module_path = Path(__file__).with_name("hersocial_attended_runner.py")
    sys.path.insert(0, str(module_path.parent))
    spec = importlib.util.spec_from_file_location("hersocial_attended_early", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AttendedEarlyApprovalTest(unittest.TestCase):
    def test_exact_approval_before_schedule_waits_without_publishing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            posts = root / "posts"
            posts.mkdir()
            asset = root / "asset.png"
            asset.write_bytes(b"approved-image")
            manifest = {
                "schema_version": "hersocial.facebook-post.v1",
                "post_key": "post-five",
                "status": "ready_for_owner_approval",
                "scheduled_at": "2026-07-24T09:00:00+07:00",
                "max_lateness_minutes": 1440,
                "message": "copy",
                "first_comment": "comment",
                "media_path": str(asset),
                "media_kind": "image",
                "media_sha256": hashlib.sha256(asset.read_bytes()).hexdigest(),
                "source_document": "post5.md",
            }
            (posts / "post5.json").write_text(json.dumps(manifest), encoding="utf-8")
            facebook = FakeFacebook()
            runner = module.HerSocialAttendedRunner(
                posts_dir=posts,
                state_path=root / "state.json",
                facebook=facebook,
                notifier=lambda _: None,
                now=lambda: datetime(2026, 7, 24, 1, 0, tzinfo=timezone.utc),
                marketing_check_command=f"python3 {Path(__file__).with_name('marketing_checker_fixture.py')}",
            )
            runner.record_approval("post-five", module.content_digest(manifest))
            result = runner.run_attended_once()
            self.assertEqual(result["status"], "approved_waiting_for_schedule")
            self.assertEqual(facebook.publish_calls, [])


if __name__ == "__main__":
    unittest.main()
