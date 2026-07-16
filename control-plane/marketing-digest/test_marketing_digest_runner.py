from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("marketing_digest_runner.py")


def load_runner_module():
    spec = importlib.util.spec_from_file_location("marketing_digest_runner", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MarketingDigestRunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_runner_module()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.deliveries: list[str] = []
        self.runner = self.module.MarketingDigestRunner(
            mirror_path=root / "mirror",
            state_path=root / "state" / "state.json",
            notifier=self.deliveries.append,
            now=lambda: datetime(2026, 7, 20, 1, 0, tzinfo=timezone.utc),
        )

    def test_schedule_is_monday_ten_am_tokyo(self) -> None:
        self.assertEqual(self.module.SCHEDULE_WEEKDAY, 0)
        self.assertEqual(self.module.SCHEDULE_HOUR, 10)
        self.assertEqual(
            self.module.SCHEDULE_LABEL,
            "Monday 08:00 Asia/Ho_Chi_Minh (= Monday 10:00 Asia/Tokyo)",
        )
        before = datetime(2026, 7, 20, 0, 59, tzinfo=timezone.utc)
        due = datetime(2026, 7, 20, 1, 0, tzinfo=timezone.utc)
        tuesday = datetime(2026, 7, 21, 1, 0, tzinfo=timezone.utc)
        self.assertFalse(self.runner.is_due(before))
        self.assertTrue(self.runner.is_due(due))
        self.assertFalse(self.runner.is_due(tuesday))

    def test_manual_delivery_does_not_suppress_scheduled_delivery(self) -> None:
        self.runner._prepare_mirror = lambda: None
        self.runner._run_digest = lambda: (0, "digest stdout\n")
        self.runner.run_once(reason="manual")
        self.assertTrue(self.runner.run_scheduled_if_due())
        self.assertEqual(self.deliveries, ["digest stdout\n", "digest stdout\n"])

    def test_digest_stdout_is_delivered_verbatim_on_exit_one(self) -> None:
        self.runner._prepare_mirror = lambda: None
        self.runner._run_digest = lambda: (1, "warning digest\nline two\n")
        self.runner.run_once(reason="manual")
        self.assertEqual(self.deliveries, ["warning digest\nline two\n"])
        self.assertEqual(self.runner.state()["last_digest_exit_code"], 1)

    def test_unrunnable_digest_delivers_safe_one_line(self) -> None:
        self.runner._prepare_mirror = lambda: None

        def fail():
            raise self.module.DigestFailure("digest script unavailable\ninternal detail")

        self.runner._run_digest = fail
        self.runner.run_once(reason="manual")
        self.assertEqual(
            self.deliveries,
            ["marketing digest FAILED to run: digest script unavailable"],
        )

    def test_digest_environment_is_allowlisted_and_excludes_transport_tokens(self) -> None:
        original = os.environ.copy()
        self.addCleanup(os.environ.clear)
        self.addCleanup(os.environ.update, original)
        os.environ.update(
            {
                "UC1_GITHUB_TOKEN": "read-only-github-token",
                "TELEGRAM_BOT_TOKEN": "telegram-token",
                "TELEGRAM_HOME_CHANNEL": "owner-chat",
                "PLAUSIBLE_API_KEY": "plausible-key",
                "MKT_GITHUB_REPO": "owner/repo",
                "UNRELATED_SECRET": "must-not-pass",
            }
        )
        digest_env = self.runner._digest_env()
        self.assertEqual(digest_env["PLAUSIBLE_API_KEY"], "plausible-key")
        self.assertEqual(digest_env["MKT_GITHUB_REPO"], "owner/repo")
        self.assertNotIn("UC1_GITHUB_TOKEN", digest_env)
        self.assertNotIn("TELEGRAM_BOT_TOKEN", digest_env)
        self.assertNotIn("TELEGRAM_HOME_CHANNEL", digest_env)
        self.assertNotIn("UNRELATED_SECRET", digest_env)
        self.assertEqual(self.runner._git_env()["GH_TOKEN"], "read-only-github-token")


if __name__ == "__main__":
    unittest.main()
