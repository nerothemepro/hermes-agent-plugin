#!/usr/bin/env python3
"""Behavior tests for the deterministic UC-1 nightly-watch runner."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


MODULE_PATH = Path(__file__).with_name("nightly_watch_runner.py")
SPEC = importlib.util.spec_from_file_location("nightly_watch_runner", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NightlyWatchRunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.state_path = self.root / "state.json"
        self.mirror = self.root / "mirror"
        self.notifications: list[str] = []
        self.runner = MODULE.NightlyWatchRunner(
            mirror_path=self.mirror,
            state_path=self.state_path,
            notifier=self.notifications.append,
            now=lambda: datetime(2026, 7, 15, 0, 5, tzinfo=timezone.utc),
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_delivers_script_stdout_verbatim_for_attention_exit(self) -> None:
        stdout = "⚠️ SDTK watch 2026-07-15 — attention needed\n• DRIFT: kit is behind\n"
        with patch.object(self.runner, "_prepare_mirror"), patch.object(
            self.runner, "_run_watch", return_value=(1, stdout)
        ):
            self.runner.run_once(reason="manual")

        self.assertEqual(self.notifications, [stdout])
        self.assertEqual(self.runner.state()["last_delivery_local_date"], "2026-07-15")

    def test_runner_failure_delivers_one_safe_line(self) -> None:
        with patch.object(self.runner, "_prepare_mirror", side_effect=RuntimeError("token=must-not-leak")):
            self.runner.run_once(reason="manual")

        self.assertEqual(self.notifications, ["nightly watch FAILED to run: unexpected runner failure"])

    def test_transport_failure_does_not_attempt_a_second_message(self) -> None:
        calls: list[str] = []

        def unavailable(text: str) -> None:
            calls.append(text)
            raise MODULE.DeliveryFailure("transport unavailable")

        self.runner.notifier = unavailable
        with patch.object(self.runner, "_prepare_mirror"), patch.object(
            self.runner, "_run_watch", return_value=(0, "✅ digest")
        ):
            self.runner.run_once(reason="manual")

        self.assertEqual(calls, ["✅ digest"])

    def test_startup_recovers_one_missed_run_after_fire_time(self) -> None:
        self.runner.now = lambda: datetime(2026, 7, 15, 1, 30, tzinfo=timezone.utc)  # 10:30 Tokyo
        self.state_path.write_text(
            json.dumps({"last_successful_delivery_at": "2026-07-13T00:00:00+00:00"}), encoding="utf-8"
        )
        with patch.object(self.runner, "run_once") as run_once:
            self.assertTrue(self.runner.should_recover_missed_run())
            self.runner.handle_startup()

        run_once.assert_called_once_with(reason="startup_recovery")

    def test_startup_recovery_does_not_double_send_after_todays_attempt(self) -> None:
        self.runner.now = lambda: datetime(2026, 7, 15, 1, 30, tzinfo=timezone.utc)  # 10:30 Tokyo
        self.state_path.write_text(
            json.dumps(
                {
                    "last_successful_delivery_at": "2026-07-13T00:00:00+00:00",
                    "last_scheduled_attempt_local_date": "2026-07-15",
                }
            ),
            encoding="utf-8",
        )
        with patch.object(self.runner, "run_once") as run_once:
            self.assertFalse(self.runner.should_recover_missed_run())
            self.runner.handle_startup()

        run_once.assert_not_called()

    def test_existing_successful_delivery_today_prevents_startup_double_send(self) -> None:
        self.runner.now = lambda: datetime(2026, 7, 15, 1, 30, tzinfo=timezone.utc)
        self.state_path.write_text(
            json.dumps(
                {
                    "last_successful_delivery_at": "2026-07-15T00:05:00+00:00",
                    "last_delivery_local_date": "2026-07-15",
                }
            ),
            encoding="utf-8",
        )

        self.assertFalse(self.runner.should_recover_missed_run())
        self.assertFalse(self.runner.run_scheduled_if_due())

    def test_manual_failure_does_not_suppress_the_scheduled_delivery(self) -> None:
        self.runner.now = lambda: datetime(2026, 7, 15, 1, 30, tzinfo=timezone.utc)
        with patch.object(self.runner, "_prepare_mirror", side_effect=MODULE.WatchFailure("probe failed")):
            self.runner.run_once(reason="manual")
        with patch.object(self.runner, "_prepare_mirror"), patch.object(
            self.runner, "_run_watch", return_value=(0, "✅ digest")
        ):
            self.assertTrue(self.runner.run_scheduled_if_due())

        self.assertEqual(self.notifications, ["nightly watch FAILED to run: probe failed", "✅ digest"])

    def test_git_environment_uses_askpass_without_persisting_token(self) -> None:
        with patch.dict(MODULE.os.environ, {"UC1_GITHUB_TOKEN": "test-token"}, clear=False):
            environment = self.runner._job_env()

        self.assertEqual(environment["GH_TOKEN"], "test-token")
        self.assertEqual(environment["GIT_TERMINAL_PROMPT"], "0")
        self.assertTrue(environment["GIT_ASKPASS"].endswith("git_askpass.sh"))

    def test_schedule_is_nine_am_tokyo_and_reports_hcm_equivalence(self) -> None:
        self.assertEqual(MODULE.SCHEDULE_LABEL, "09:00 Asia/Tokyo (= 07:00 Asia/Ho_Chi_Minh per packet)")
        now = datetime(2026, 7, 15, 0, 0, tzinfo=timezone.utc)  # 09:00 Tokyo
        self.assertTrue(self.runner.is_due(now))


if __name__ == "__main__":
    unittest.main()
