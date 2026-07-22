from __future__ import annotations

import unittest
from pathlib import Path


INSTALLER = Path(__file__).with_name("install-hersocial-auto-post.sh")


class InstallerContractTest(unittest.TestCase):
    def test_installer_precreates_durable_runtime_directory_before_supervisor_reload(self):
        text = INSTALLER.read_text(encoding="utf-8")
        mkdir_position = text.index("install -d -m 700 /opt/data/hermes/control-plane/hersocial-auto-post")
        reread_position = text.index("supervisorctl", mkdir_position)
        self.assertLess(mkdir_position, reread_position)
        self.assertIn("reread", text)
        self.assertIn("update", text)
        self.assertNotIn("HERSOCIAL_AUTO_POST_ENABLED=true", text)


if __name__ == "__main__":
    unittest.main()
