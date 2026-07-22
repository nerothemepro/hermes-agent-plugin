from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from test_hersocial_auto_post_runner import FakeFacebook


def load_module():
    import importlib.util
    import sys
    module_path = Path(__file__).with_name("hersocial_attended_runner.py")
    sys.path.insert(0, str(module_path.parent))
    spec = importlib.util.spec_from_file_location("hersocial_attended_runner", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AttendedApprovalFlowTest(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.posts = self.root / "posts"
        self.posts.mkdir()
        self.state = self.root / "state.json"
        self.asset = self.root / "pricing.png"
        self.asset.write_bytes(b"real-pricing-screenshot")
        self.now = lambda: datetime(2026, 7, 24, 2, 0, tzinfo=timezone.utc)
        self.manifest = {
            "schema_version": "hersocial.facebook-post.v1",
            "post_key": "sdtk-pro-live-post-5",
            "status": "ready_for_owner_approval",
            "scheduled_at": "2026-07-24T09:00:00+07:00",
            "max_lateness_minutes": 1440,
            "message": "Exact English Page copy",
            "first_comment": "Exact Vietnamese first comment",
            "media_path": str(self.asset),
            "media_kind": "image",
            "media_sha256": __import__("hashlib").sha256(self.asset.read_bytes()).hexdigest(),
            "source_document": "governance/marketing/post5.md",
        }
        (self.posts / "post5.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def runner(self, *, facebook=None, deliveries=None, reminders=True):
        return self.module.HerSocialAttendedRunner(
            posts_dir=self.posts,
            state_path=self.state,
            facebook=facebook or FakeFacebook(),
            notifier=(deliveries if deliveries is not None else []).append,
            now=self.now,
            reminders_enabled=reminders,
            marketing_check_command=f"python3 {Path(__file__).with_name('marketing_checker_fixture.py')}",
        )

    def test_due_manifest_sends_exact_approval_packet_once_without_facebook(self):
        facebook = FakeFacebook()
        deliveries = []
        runner = self.runner(facebook=facebook, deliveries=deliveries)

        first = runner.run_attended_once()
        second = runner.run_attended_once()

        digest = self.module.content_digest(self.manifest)
        self.assertEqual(first["status"], "approval_requested")
        self.assertEqual(second["status"], "no_op")
        self.assertEqual(len(deliveries), 1)
        self.assertIn(self.manifest["scheduled_at"], deliveries[0])
        self.assertIn(self.manifest["message"], deliveries[0])
        self.assertIn(self.manifest["first_comment"], deliveries[0])
        self.assertIn(str(self.asset), deliveries[0])
        self.assertIn(f"APPROVE HERSOCIAL POST {self.manifest['post_key']} {digest}", deliveries[0])
        self.assertEqual(facebook.publish_calls, [])

    def test_wrong_digest_records_no_approval_and_makes_no_facebook_call(self):
        facebook = FakeFacebook()
        runner = self.runner(facebook=facebook)

        with self.assertRaisesRegex(self.module.AutoPostFailure, "approval_digest_mismatch"):
            runner.record_approval(self.manifest["post_key"], "0" * 64)

        self.assertFalse(self.state.exists())
        self.assertEqual(facebook.publish_calls, [])

    def test_exact_approval_is_persisted_then_consumed_once(self):
        facebook = FakeFacebook()
        deliveries = []
        runner = self.runner(facebook=facebook, deliveries=deliveries)
        digest = self.module.content_digest(self.manifest)

        approval = runner.record_approval(self.manifest["post_key"], digest)
        published = runner.run_attended_once()
        second = runner.run_attended_once()

        self.assertEqual(approval["status"], "approved_pending_publish")
        self.assertEqual(published["status"], "published")
        self.assertEqual(second["status"], "no_op")
        self.assertEqual(len(facebook.publish_calls), 1)
        self.assertEqual(len(facebook.comment_calls), 1)
        self.assertIn("PUBLISHED", deliveries[-1])

    def test_disabled_reminders_do_not_notify_or_publish(self):
        facebook = FakeFacebook()
        deliveries = []
        result = self.runner(facebook=facebook, deliveries=deliveries, reminders=False).run_attended_once()
        self.assertEqual(result["status"], "disabled")
        self.assertEqual(deliveries, [])
        self.assertEqual(facebook.publish_calls, [])


if __name__ == "__main__":
    unittest.main()
