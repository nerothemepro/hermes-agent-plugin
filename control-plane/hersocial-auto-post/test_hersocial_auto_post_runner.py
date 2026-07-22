from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("hersocial_auto_post_runner.py")


def load_module():
    spec = importlib.util.spec_from_file_location("hersocial_auto_post_runner", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeFacebook:
    def __init__(self, existing=None, publish_result=None, comment_error=None):
        self.existing = existing
        self.publish_result = publish_result or {
            "post_id": "post-validation-1",
            "permalink_url": "https://facebook.example/post-validation-1",
        }
        self.comment_error = comment_error
        self.publish_calls = []
        self.comment_calls = []

    def find_exact_post(self, message):
        return self.existing

    def publish(self, *, message, media_path):
        self.publish_calls.append({"message": message, "media_path": media_path})
        return self.publish_result

    def comment(self, *, post_id, message):
        self.comment_calls.append({"post_id": post_id, "message": message})
        if self.comment_error:
            raise self.comment_error
        return {"comment_id": "comment-validation-1"}


class HerSocialAutoPostRunnerTest(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.posts_dir = self.root / "posts"
        self.posts_dir.mkdir()
        self.state_path = self.root / "state" / "state.json"
        self.now = lambda: datetime(2026, 7, 23, 0, 0, tzinfo=timezone.utc)

    def manifest(self, **overrides):
        media_path = self.root / "post2.png"
        media_path.write_bytes(b"image")
        value = {
            "schema_version": "hersocial.facebook-post.v1",
            "post_key": "hero-pack-post-2",
            "status": "approved",
            "scheduled_at": "2026-07-23T09:00:00+09:00",
            "max_lateness_minutes": 60,
            "message": "Approved English Page body",
            "first_comment": "Approved Vietnamese first comment",
            "media_path": str(media_path),
            "media_kind": "image",
            "source_document": "governance/marketing/post2.md",
            "approval": {
                "approved_by": "owner",
                "approved_content_sha256": "pending",
            },
        }
        value.update(overrides)
        value["approval"]["approved_content_sha256"] = self.module.content_digest(value)
        return value

    def write_manifest(self, manifest):
        path = self.posts_dir / f"{manifest['post_key']}.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def runner(self, *, facebook=None, enabled=True, deliveries=None):
        output = deliveries if deliveries is not None else []
        return self.module.HerSocialAutoPostRunner(
            posts_dir=self.posts_dir,
            state_path=self.state_path,
            facebook=facebook or FakeFacebook(),
            notifier=output.append,
            now=self.now,
            enabled=enabled,
        )

    def test_unapproved_manifest_fails_closed(self):
        manifest = self.manifest(status="draft")
        with self.assertRaisesRegex(self.module.AutoPostFailure, "manifest_not_approved"):
            self.module.validate_manifest(manifest, now=self.now())

    def test_content_digest_drift_fails_closed(self):
        manifest = self.manifest()
        manifest["message"] = "Changed after owner approval"
        with self.assertRaisesRegex(self.module.AutoPostFailure, "approval_digest_mismatch"):
            self.module.validate_manifest(manifest, now=self.now())

    def test_missing_required_media_fails_closed(self):
        manifest = self.manifest(media_path=str(self.root / "missing.png"))
        manifest["approval"]["approved_content_sha256"] = self.module.content_digest(manifest)
        with self.assertRaisesRegex(self.module.AutoPostFailure, "media_missing"):
            self.module.validate_manifest(manifest, now=self.now())

    def test_video_manifest_is_rejected(self):
        manifest = self.manifest(media_kind="video")
        manifest["approval"]["approved_content_sha256"] = self.module.content_digest(manifest)
        with self.assertRaisesRegex(self.module.AutoPostFailure, "video_not_supported"):
            self.module.validate_manifest(manifest, now=self.now())

    def test_stale_manifest_is_blocked_instead_of_catching_up_late(self):
        manifest = self.manifest(scheduled_at="2026-07-22T09:00:00+09:00")
        manifest["approval"]["approved_content_sha256"] = self.module.content_digest(manifest)
        with self.assertRaisesRegex(self.module.AutoPostFailure, "schedule_too_late"):
            self.module.validate_manifest(manifest, now=self.now())

    def test_disabled_runner_never_calls_facebook(self):
        manifest = self.manifest()
        self.write_manifest(manifest)
        facebook = FakeFacebook()
        result = self.runner(facebook=facebook, enabled=False).run_once()
        self.assertEqual(result["status"], "disabled")
        self.assertEqual(facebook.publish_calls, [])

    def test_exact_existing_post_is_adopted_without_duplicate(self):
        manifest = self.manifest()
        self.write_manifest(manifest)
        facebook = FakeFacebook(
            existing={
                "post_id": "existing-post",
                "permalink_url": "https://facebook.example/existing-post",
            }
        )
        deliveries = []
        result = self.runner(facebook=facebook, deliveries=deliveries).run_once()
        self.assertEqual(result["status"], "adopted")
        self.assertEqual(facebook.publish_calls, [])
        self.assertIn("ADOPTED", deliveries[0])

    def test_due_post_publishes_once_comments_and_reports(self):
        manifest = self.manifest()
        self.write_manifest(manifest)
        facebook = FakeFacebook()
        deliveries = []
        runner = self.runner(facebook=facebook, deliveries=deliveries)
        first = runner.run_once()
        second = runner.run_once()
        self.assertEqual(first["status"], "published")
        self.assertEqual(second["status"], "no_op")
        self.assertEqual(len(facebook.publish_calls), 1)
        self.assertEqual(len(facebook.comment_calls), 1)
        self.assertIn("PUBLISHED", deliveries[0])
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["posts"][manifest["post_key"]]["status"], "published")
        self.assertEqual(self.state_path.stat().st_mode & 0o777, 0o600)

    def test_first_comment_failure_is_partial_and_primary_post_is_not_retried(self):
        manifest = self.manifest()
        self.write_manifest(manifest)
        facebook = FakeFacebook(comment_error=self.module.GraphFailure("HTTP 403"))
        deliveries = []
        runner = self.runner(facebook=facebook, deliveries=deliveries)
        first = runner.run_once()
        second = runner.run_once()
        self.assertEqual(first["status"], "partial")
        self.assertEqual(second["status"], "no_op")
        self.assertEqual(len(facebook.publish_calls), 1)
        self.assertIn("PARTIAL", deliveries[0])
        self.assertNotIn("HTTP 403", deliveries[0])

    def test_preview_returns_digest_without_full_post_or_side_effect(self):
        manifest = self.manifest()
        self.write_manifest(manifest)
        facebook = FakeFacebook()
        result = self.runner(facebook=facebook).preview(manifest["post_key"])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["content_sha256"], self.module.content_digest(manifest))
        self.assertNotIn("message", result)
        self.assertEqual(facebook.publish_calls, [])


if __name__ == "__main__":
    unittest.main()
