#!/usr/bin/env python3
import importlib.util
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

MODULE = Path(__file__).with_name("hersocial_marketing_automation_runner.py")
spec = importlib.util.spec_from_file_location("hersocial_marketing_automation_runner", MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class MarketingAutomationRunnerTests(unittest.TestCase):
    def test_due_at_monday_0800_ict(self):
        runner = module.MarketingAutomationRunner(state_path=Path(tempfile.mkdtemp()) / "state.json")
        self.assertTrue(runner._is_due(datetime(2026, 7, 27, 1, 0, tzinfo=timezone.utc)))
        self.assertFalse(runner._is_due(datetime(2026, 7, 27, 0, 59, tzinfo=timezone.utc)))

    def test_build_message_preserves_each_command_output(self):
        outputs = iter(["digest output\n", "pull output\n", "eval output\n", "report output\n"])
        runner = module.MarketingAutomationRunner(
            state_path=Path(tempfile.mkdtemp()) / "state.json",
            command=lambda _args: subprocess.CompletedProcess(_args, 0, next(outputs), ""),
        )
        message = runner._build_message()
        self.assertIn("$ sdtk-marketing digest\ndigest output", message)
        self.assertIn("$ sdtk-marketing attribution pull distribution-r2\npull output", message)
        self.assertIn("$ sdtk-marketing eval distribution-r2\neval output", message)
        self.assertIn("$ sdtk-marketing report distribution-r2\nreport output", message)

    def test_command_failure_is_fail_closed(self):
        runner = module.MarketingAutomationRunner(
            state_path=Path(tempfile.mkdtemp()) / "state.json",
            command=lambda args: subprocess.CompletedProcess(args, 1, "", "failure"),
        )
        with self.assertRaisesRegex(module.AutomationFailure, "digest failed"):
            runner._build_message()

if __name__ == "__main__":
    unittest.main()
