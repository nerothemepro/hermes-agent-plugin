from __future__ import annotations

import unittest
from pathlib import Path


WRAPPER = Path(__file__).with_name("start-hersocial-marketing-video.sh")


class MarketingVideoRuntimeContractTest(unittest.TestCase):
    def test_social_copy_delegate_is_allowlisted_into_clean_video_environment(self):
        text = WRAPPER.read_text(encoding="utf-8")

        self.assertIn("SDTK_MARKETING_SOCIAL_COPY_CMD", text)
        self.assertIn("SDTK_MARKETING_SOCIAL_COPY_TIMEOUT_MS", text)
        self.assertIn("exec env -i", text)
        self.assertIn("mkt-digest.env", text)
        self.assertIn('stat -c %a "$marketing_env"', text)
        self.assertNotIn("set -x", text)
        self.assertNotIn("echo $FB_PAGE_TOKEN", text)
        self.assertNotIn("echo $YOUTUBE_REFRESH_TOKEN", text)


if __name__ == "__main__":
    unittest.main()
