from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = Path(__file__).with_name("start-hersocial-auto-post.sh")
PROGRAM = ROOT / "supervisord" / "hermes-hersocial-auto-post.conf"
MAIN_SUPERVISOR = ROOT / "supervisord" / "supervisord.conf"


class RuntimeContractTest(unittest.TestCase):
    def test_wrapper_sources_only_mounted_secret_files_and_uses_clean_environment(self):
        text = WRAPPER.read_text(encoding="utf-8")
        self.assertIn("/opt/data/hermes-profiles/hersocial/.env", text)
        self.assertIn("/opt/data/hermes/control-plane/secrets/mkt-digest.env", text)
        self.assertIn('"FACEBOOK_PAGE_ACCESS_TOKEN=$FB_PAGE_TOKEN"', text)
        self.assertIn('"FACEBOOK_PAGE_ID=$FB_PAGE_ID"', text)
        self.assertIn("exec env -i", text)
        self.assertIn('marketing_check_command="${HERSOCIAL_MARKETING_CHECK_COMMAND:-sdtk-marketing}"', text)
        self.assertIn('"HERSOCIAL_MARKETING_CHECK_COMMAND=$marketing_check_command"', text)
        self.assertNotIn("echo $FB_PAGE_TOKEN", text)
        self.assertNotIn("set -x", text)

    def test_supervisor_program_is_disabled_by_default_and_persistent(self):
        text = PROGRAM.read_text(encoding="utf-8")
        self.assertIn("autostart=true", text)
        self.assertIn("autorestart=true", text)
        self.assertIn('HERSOCIAL_AUTO_POST_ENABLED="false"', text)
        self.assertIn('HERSOCIAL_ATTENDED_REMINDERS_ENABLED="true"', text)
        self.assertIn('hersocial_attended_runner.py', WRAPPER.read_text(encoding="utf-8"))
        self.assertIn("/opt/data/hermes/control-plane/hersocial-auto-post/supervisord.log", text)

    def test_main_supervisor_includes_auto_post_program(self):
        text = MAIN_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("hermes-hersocial-auto-post.conf", text)


if __name__ == "__main__":
    unittest.main()
