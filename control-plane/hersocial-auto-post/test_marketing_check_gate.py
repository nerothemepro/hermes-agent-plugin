from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from test_attended_approval_flow import load_module
from test_hersocial_auto_post_runner import FakeFacebook


CHECKER = r'''import json, sys
text = sys.stdin.read()
if "UNAVAILABLE" in text:
    print("not-json")
    raise SystemExit(2)
if "Trusted by 500 devs" in text:
    print(json.dumps({"errors": 2, "warnings": 0, "findings": [
        {"line": 1, "rule": "social-proof", "severity": "error", "message": "unverified social proof", "snippet": "Trusted by 500 devs"},
        {"line": 1, "rule": "multiplier", "severity": "error", "message": "unverified multiplier", "snippet": "10x faster"}
    ]}))
    raise SystemExit(1)
if "screen recording" in text:
    print(json.dumps({"errors": 0, "warnings": 1, "findings": [
        {"line": 1, "rule": "asset-framing", "severity": "warning", "message": "verify against asset", "snippet": "screen recording"}
    ]}))
    raise SystemExit(0)
print(json.dumps({"errors": 0, "warnings": 0, "findings": []}))
'''


class MarketingCheckGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.posts = self.root / "posts"
        self.posts.mkdir()
        self.state = self.root / "state.json"
        self.asset = self.root / "asset.png"
        self.asset.write_bytes(b"asset")
        self.checker = self.root / "checker.py"
        self.checker.write_text(CHECKER, encoding="utf-8")
        self.command = f"{sys.executable} {self.checker}"
        self.now = lambda: datetime(2026, 7, 24, 2, 0, tzinfo=timezone.utc)

    def write_manifest(self, message: str, first_comment: str = "Vietnamese comment") -> dict:
        manifest = {
            "schema_version": "hersocial.facebook-post.v1",
            "post_key": "check-gate-post",
            "status": "ready_for_owner_approval",
            "scheduled_at": "2026-07-24T09:00:00+07:00",
            "max_lateness_minutes": 1440,
            "message": message,
            "first_comment": first_comment,
            "media_path": str(self.asset),
            "media_kind": "image",
            "media_sha256": hashlib.sha256(self.asset.read_bytes()).hexdigest(),
            "source_document": "governance/marketing/post.md",
        }
        (self.posts / "post.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def runner(self, deliveries: list[str], *, command: str | None = None):
        return self.module.HerSocialAttendedRunner(
            posts_dir=self.posts,
            state_path=self.state,
            facebook=FakeFacebook(),
            notifier=deliveries.append,
            now=self.now,
            reminders_enabled=True,
            marketing_check_command=command if command is not None else self.command,
            marketing_check_timeout_seconds=5,
        )

    def test_clean_copy_reaches_owner_approval_packet(self) -> None:
        self.write_manifest("Truthful exact copy")
        deliveries: list[str] = []

        result = self.runner(deliveries).run_attended_once()

        self.assertEqual(result["status"], "approval_requested")
        self.assertIn("MARKETING CHECK: PASS (0 errors, 0 warnings)", deliveries[0])
        self.assertIn("APPROVE HERSOCIAL POST", deliveries[0])

    def test_warning_is_surfaced_but_does_not_block(self) -> None:
        self.write_manifest("This is a screen recording")
        deliveries: list[str] = []

        result = self.runner(deliveries).run_attended_once()

        self.assertEqual(result["status"], "approval_requested")
        self.assertIn("MARKETING CHECK: PASS WITH 1 WARNING(S)", deliveries[0])
        self.assertIn("asset-framing: verify against asset", deliveries[0])
        self.assertIn("APPROVE HERSOCIAL POST", deliveries[0])

    def test_errors_notify_owner_and_withhold_approval_packet(self) -> None:
        self.write_manifest("Trusted by 500 devs, 10x faster.")
        deliveries: list[str] = []
        runner = self.runner(deliveries)

        first = runner.run_attended_once()
        second = runner.run_attended_once()

        self.assertEqual(first["status"], "check_blocked")
        self.assertEqual(second["status"], "check_blocked")
        self.assertEqual(len(deliveries), 1)
        self.assertIn("post check-gate-post bị check chặn: 2 lỗi", deliveries[0])
        self.assertNotIn("APPROVE HERSOCIAL POST", deliveries[0])
        self.assertEqual(json.loads(self.state.read_text())["posts"]["check-gate-post"]["status"], "check_blocked")

    def test_unavailable_checker_fails_closed_and_notifies_owner(self) -> None:
        self.write_manifest("Truthful exact copy")
        deliveries: list[str] = []

        result = self.runner(deliveries, command="/missing/sdtk-marketing").run_attended_once()

        self.assertEqual(result["status"], "check_unavailable")
        self.assertIn("post check-gate-post bị chặn: check unavailable", deliveries[0])
        self.assertNotIn("APPROVE HERSOCIAL POST", deliveries[0])

    def test_exact_approval_cannot_bypass_check(self) -> None:
        manifest = self.write_manifest("Trusted by 500 devs, 10x faster.")
        deliveries: list[str] = []

        with self.assertRaisesRegex(self.module.AutoPostFailure, "marketing_check_blocked"):
            self.runner(deliveries).record_approval(
                manifest["post_key"], self.module.content_digest(manifest)
            )

        self.assertFalse(self.state.exists())


if __name__ == "__main__":
    unittest.main()
