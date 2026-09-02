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
        monitor.stale_seconds = 900
        monitor.toolchain_root = root / "toolchain"
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
        state.write_text(json.dumps({"run_id": "run_test", "status": "running" if status == "running_external" else status, "tasks": {"worker": {"status": status, "external_ids": {"hermes_task_id": "t_test"}}}}))
        (monitor.registry / "run_test.json").write_text(json.dumps({
            "run_id": "run_test",
            "state_path": str(state),
            "canonical_report_path": str(ledger / "reports" / "final_report.md"),
        }))
        return monitor

    def test_observation_contains_shared_normalized_state(self):
        monitor = self.make_monitor("completed")
        with patch.object(monitor, "_infrastructure_checks", return_value={}):
            observations = monitor.tick()
        self.assertEqual(observations[1]["normalized"]["status"], "completed")
        self.assertTrue(observations[1]["normalized"]["terminal"])


    def test_waiting_gate_notification_only_fires_after_transition(self):
        monitor = self.make_monitor("running_external")
        state_path = Path(next(iter(monitor._registry_records()))["state_path"])
        with patch.object(monitor, "_infrastructure_checks", return_value={}), patch.object(monitor, "_run", return_value={"status": "running_external"}):
            monitor.tick()
            monitor.tick()
        state_path.write_text(json.dumps({"run_id": "run_test", "status": "waiting_for_approval", "waiting_gate": "owner_review", "tasks": {"owner_review": {"type": "human_gate", "status": "waiting_for_approval"}}}))
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


    def test_stale_external_notification_contains_operator_fields(self):
        monitor = self.make_monitor("running_external")
        monitor.bootstrap_path.write_text("ready\n")
        record = monitor._registry_records()[0]
        state_path = Path(record["state_path"])
        old = (datetime.now(timezone.utc) - timedelta(seconds=1200)).isoformat()
        state_path.write_text(json.dumps({
            "run_id": "run_test",
            "status": "running",
            "tasks": {"episode_render": {
                "status": "running_external", "role": "video", "last_heartbeat": old,
                "external_ids": {"hermes_task_id": "t_render"},
            }},
        }))
        with patch.object(monitor, "_infrastructure_checks", return_value={}), patch.object(monitor, "_hermes_task_status", return_value="running"), patch.object(monitor, "_notify") as notify:
            monitor.tick()
        texts = [call.args[1] for call in notify.call_args_list]
        self.assertTrue(any("episode_render" in text and "video" in text and "last heartbeat" in text for text in texts))

    def test_multiple_completed_external_tasks_continue_only_once(self):
        monitor = self.make_monitor("running_external")
        monitor.bootstrap_path.write_text("ready\n")
        record = monitor._registry_records()[0]
        Path(record["state_path"]).write_text(json.dumps({
            "run_id": "run_test",
            "status": "running",
            "tasks": {
                "research_evidence": {"status": "running_external", "external_ids": {"hermes_task_id": "t_research"}},
                "episode_lessons": {"status": "running_external", "external_ids": {"hermes_task_id": "t_wiki"}},
            },
        }))
        with patch.object(monitor, "_infrastructure_checks", return_value={}), patch.object(monitor, "_hermes_task_status", return_value="done"), patch.object(monitor, "_run", return_value={"status": "running"}) as run:
            observations = monitor.tick()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(observations[1]["action"], "continue")

    def test_monitor_routes_sdtk_through_active_staging_release(self):
        monitor = self.make_monitor("completed")
        release = monitor.toolchain_root / "releases" / "release-a"
        release.mkdir(parents=True)
        (monitor.toolchain_root / "active-release").write_text("release-a\n")
        (release / "release.json").write_text(json.dumps({
            "release_id": "release-a",
            "packages": {"sdtk-agent-kit": {"version": "0.5.4"}, "sdtk-agent-hermes-adapter": {"version": "0.3.10"}},
        }))
        wrapper = monitor.project_path / "control-plane" / "video-dogfood" / "staging" / "with-active-toolchain.sh"
        wrapper.parent.mkdir(parents=True)
        wrapper.write_text("#!/usr/bin/env bash\n")
        command = monitor._sdtk_command(["sdtk-agent", "run", "continue"])
        self.assertEqual(command, [str(wrapper), "sdtk-agent", "run", "continue"])


    def test_active_release_identity_contains_versions_only(self):
        monitor = self.make_monitor("completed")
        release = monitor.toolchain_root / "releases" / "release-a"
        release.mkdir(parents=True)
        (monitor.toolchain_root / "active-release").write_text("release-a\n")
        (release / "release.json").write_text(json.dumps({
            "release_id": "release-a",
            "packages": {"sdtk-agent-kit": {"version": "0.5.4"}, "sdtk-agent-hermes-adapter": {"version": "0.3.10"}},
        }))
        self.assertEqual(monitor._active_release(), {
            "release_id": "release-a",
            "sdtk_agent": "0.5.4",
            "hermes_adapter": "0.3.10",
        })


if __name__ == "__main__":
    unittest.main()

    def test_self_service_gate_notification_contains_only_derived_packet_sha(self):
        monitor = self.make_monitor("running_external")
        monitor.bootstrap_path.write_text("ready\n")
        record_path = monitor.registry / "run_test.json"
        record = json.loads(record_path.read_text())
        record["episode_manifest_sha256"] = "a" * 64
        record_path.write_text(json.dumps(record))
        state_path = Path(record["state_path"])
        state_path.write_text(json.dumps({
            "run_id": "run_test", "status": "waiting_for_approval", "waiting_gate": "owner_story_lock",
            "tasks": {"owner_story_lock": {"type": "human_gate", "status": "waiting_for_approval"}},
        }))
        packet = {"status": "gate_packet_ready", "packet_sha256": "b" * 64}
        with patch.object(monitor, "_infrastructure_checks", return_value={}), patch.object(monitor, "_gate_packet", return_value=packet), patch.object(monitor, "_notify") as notify:
            monitor.tick()
        text = notify.call_args.args[1]
        self.assertIn("APPROVE VIDEO GATE run_test story_lock " + ("b" * 64), text)
        self.assertNotIn("evidence_path", text)

    def test_gate_packet_preview_refuses_invalid_controller_response(self):
        monitor = self.make_monitor("completed")
        completed = type("Result", (), {"returncode": 0, "stdout": '{"status":"gate_packet_ready","packet_sha256":"bad"}'})()
        with patch("subprocess.run", return_value=completed):
            self.assertIsNone(monitor._gate_packet("run_test", "owner_story_lock"))
