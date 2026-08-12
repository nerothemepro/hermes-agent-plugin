#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import multiprocessing
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODULE_PATH = ROOT / "hersocial_social_publisher_dispatcher.py"


def load_module():
    spec = importlib.util.spec_from_file_location("hersocial_social_publisher_dispatcher", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def lock_probe_worker(module_path, home_path, post_key, digest, marker_path):
    spec = importlib.util.spec_from_file_location("hersocial_social_publisher_dispatcher_child", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    def runner(_):
        Path(marker_path).write_text("runner-called", encoding="utf-8")
        return {"status": "published", "post_key": post_key, "content_sha256": digest, "video_url": "https://youtu.be/example"}

    module.record_approval(post_key, digest, Path(home_path), runner)


def publisher_record(project_id, platform, digest):
    post_key = "social-video-" + platform + "-" + hashlib.sha256((project_id + platform).encode()).hexdigest()[:16]
    return {
        "schema_version": "sdtk.marketing-social-publisher.v1",
        "project_id": project_id,
        "platform": platform,
        "post_key": post_key,
        "content_sha256": digest,
        "approval_command": "APPROVE HERSOCIAL POST " + post_key + " " + digest,
        "publisher_payload": {"assetId": post_key},
    }


class SocialPublisherDispatcherTest(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name) / "marketing"
        self.digest = "a" * 64
        self.record = publisher_record("preview-studio", "youtube", self.digest)
        target = self.home / "video-projects" / "preview-studio" / "social"
        target.mkdir(parents=True)
        (target / "publisher-youtube.json").write_text(json.dumps(self.record), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_exact_record_invokes_only_bounded_publisher_command(self):
        seen = []

        def runner(args):
            seen.append(args)
            return {"status": "published", "post_key": self.record["post_key"], "content_sha256": self.digest, "video_url": "https://youtu.be/example"}

        result = self.module.record_approval(self.record["post_key"], self.digest, self.home, runner)
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["video_url"], "https://youtu.be/example")
        self.assertEqual(seen, [["video", "social", "publish", "preview-studio", "--platform", "youtube", "--approve", self.digest, "--json"]])

    def test_wrong_digest_fails_before_runner(self):
        with self.assertRaisesRegex(self.module.DispatchFailure, "publisher_record_not_found"):
            self.module.record_approval(self.record["post_key"], "b" * 64, self.home, lambda _: self.fail("must not run"))

    def test_second_exact_approval_is_idempotent_from_publish_record(self):
        publishes = self.home / "publishes"
        publishes.mkdir(parents=True)
        (publishes / ("youtube-" + self.record["publisher_payload"]["assetId"] + ".json")).write_text(json.dumps({
            "approved_sha": self.digest,
            "video_url": "https://youtu.be/already-published",
        }), encoding="utf-8")
        result = self.module.record_approval(self.record["post_key"], self.digest, self.home, lambda _: self.fail("must not run"))
        self.assertEqual(result["status"], "published")
        self.assertEqual(result["video_url"], "https://youtu.be/already-published")

    def test_unpublished_facebook_upload_keeps_uploaded_status(self):
        record = publisher_record("preview-studio", "facebook", self.digest)
        target = self.home / "video-projects" / "preview-studio" / "social"
        (target / "publisher-facebook.json").write_text(json.dumps(record), encoding="utf-8")

        def runner(_):
            return {
                "status": "uploaded",
                "post_key": record["post_key"],
                "content_sha256": self.digest,
                "video_url": "https://www.facebook.com/reel/draft-example/",
                "visibility_state": "unpublished",
                "next_action": "manual_visibility_review_required",
            }

        result = self.module.record_approval(record["post_key"], self.digest, self.home, runner)

        self.assertEqual(result["status"], "uploaded")
        self.assertEqual(result["visibility_state"], "unpublished")
        self.assertEqual(result["video_url"], "https://www.facebook.com/reel/draft-example/")
        self.assertEqual(result["next_action"], "manual_visibility_review_required")

    def test_existing_relative_facebook_permalink_is_normalized_before_return(self):
        record = publisher_record("preview-studio", "facebook", self.digest)
        target = self.home / "video-projects" / "preview-studio" / "social"
        (target / "publisher-facebook.json").write_text(json.dumps(record), encoding="utf-8")
        publishes = self.home / "publishes"
        publishes.mkdir(parents=True)
        (publishes / ("facebook-" + record["publisher_payload"]["assetId"] + ".json")).write_text(json.dumps({
            "approved_sha": self.digest,
            "video_url": "/reel/example/",
        }), encoding="utf-8")

        result = self.module.record_approval(record["post_key"], self.digest, self.home, lambda _: self.fail("must not run"))

        self.assertEqual(result["video_url"], "https://www.facebook.com/reel/example/")

    def test_same_post_key_is_serialized_across_processes(self):
        marker = self.home / "runner-marker"
        with self.module.approval_lock(self.record["post_key"], self.home):
            process = multiprocessing.Process(
                target=lock_probe_worker,
                args=(str(MODULE_PATH), str(self.home), self.record["post_key"], self.digest, str(marker)),
            )
            process.start()
            time.sleep(0.15)
            self.assertFalse(marker.exists())
        process.join(timeout=3)
        self.assertEqual(process.exitcode, 0)
        self.assertTrue(marker.exists())

    def test_duplicate_matching_records_fail_closed(self):
        extra = self.home / "video-projects" / "other" / "social"
        extra.mkdir(parents=True)
        (extra / "publisher-youtube.json").write_text(json.dumps(self.record), encoding="utf-8")
        with self.assertRaisesRegex(self.module.DispatchFailure, "publisher_record_ambiguous"):
            self.module.record_approval(self.record["post_key"], self.digest, self.home, lambda _: self.fail("must not run"))


if __name__ == "__main__":
    unittest.main()
