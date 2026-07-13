import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from hermes_control_plane_monitor import Monitor


class MonitorContractTests(unittest.TestCase):
    def make_monitor(self, status):
        root = Path(tempfile.mkdtemp())
        monitor = object.__new__(Monitor)
        monitor.hermes_home = root
        monitor.registry = root / "runs"
        monitor.state_dir = root / "monitor"
        monitor.dedupe_path = monitor.state_dir / "notifications.json"
        monitor.seen_path = monitor.state_dir / "run-statuses.json"
        monitor.bootstrap_path = monitor.state_dir / "bootstrap-complete"
        monitor.zombie_baseline_path = monitor.state_dir / "zombie-baseline.json"
        monitor.project_path = root
        monitor.interval = 10
        monitor.deadline_ratio = 0.75
        monitor.token_env = "TEST_TOKEN"
        monitor.chat_env = "TEST_CHAT"
        monitor.dedupe = {}
        monitor.seen = {}
        monitor.registry.mkdir()
        monitor.state_dir.mkdir()
        monitor.zombie_baseline_path.write_text(json.dumps({"count": 0}))
        ledger = root / "ledger"
        ledger.mkdir()
        state = ledger / "state.json"
        state.write_text(json.dumps({"status": "running" if status == "running_external" else status, "tasks": {"worker": {"status": status, "external_ids": {"hermes_task_id": "t_test"}}}}))
        (monitor.registry / "run_test.json").write_text(json.dumps({
            "run_id": "run_test",
            "state_path": str(state),
            "canonical_report_path": str(ledger / "reports" / "final_report.md"),
        }))
        return monitor

    def test_waiting_gate_notification_only_fires_after_transition(self):
        monitor = self.make_monitor("running_external")
        state_path = Path(next(iter(monitor._registry_records()))["state_path"])
        with patch.object(monitor, "_infrastructure_checks", return_value={}), patch.object(monitor, "_run", return_value={"status": "running_external"}):
            monitor.tick()
            monitor.tick()
        state_path.write_text(json.dumps({"status": "waiting_for_approval", "waiting_gate": "owner_review"}))
        with patch.object(monitor, "_notify") as notify:
            monitor.tick()
        self.assertEqual(notify.call_count, 1)
        self.assertEqual(notify.call_args[0][0], "run_test:waiting_for_approval:owner_review")

    def test_completed_external_run_is_the_only_auto_mutation(self):
        monitor = self.make_monitor("running_external")
        with patch.object(monitor, "_infrastructure_checks", return_value={}), patch.object(monitor, "_hermes_task_status", side_effect=["running", "done"]), patch.object(monitor, "_run", return_value={"status": "completed"}) as run:
            monitor.tick()
            monitor.tick()
            observations = monitor.tick()
        self.assertEqual(observations[1]["action"], "continue")
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ["sdtk-agent", "run", "continue"],
        ])

    def test_deadline_risk_looks_ahead_one_tick(self):
        now = datetime.now(timezone.utc)
        task = {
            "submitted_at": (now - timedelta(seconds=40)).isoformat(),
            "deadline_at": (now + timedelta(seconds=20)).isoformat(),
        }
        self.assertTrue(Monitor._deadline_risk(task, 0.75, 10))

    def test_notification_state_records_only_digest_and_timestamp(self):
        monitor = self.make_monitor("completed")
        monitor.token_env = "TEST_TOKEN"
        monitor.chat_env = "TEST_CHAT"
        with patch.dict("os.environ", {"TEST_TOKEN": "hidden", "TEST_CHAT": "123"}, clear=False), patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.status = 200
            monitor._notify("deadline", "safe alert")
        stored = monitor.dedupe["deadline"]
        self.assertEqual(set(stored), {"hash", "sent_at"})
        self.assertEqual(len(stored["hash"]), 64)
        self.assertNotIn("hidden", json.dumps(stored))

    def test_monitor_rejects_unallowlisted_sdtk_action(self):
        monitor = self.make_monitor("completed")
        with self.assertRaises(ValueError):
            monitor._run(["sdtk-agent", "gate", "approve"], "run_test")


if __name__ == "__main__":
    unittest.main()
