import unittest
from pathlib import Path

WRAPPER = Path(__file__).resolve().parents[1] / "start-hersocial-marketing-video.sh"

class RuntimeContractTest(unittest.TestCase):
    def test_capture_composition_is_validated_and_bound_to_delegate_command(self):
        text = WRAPPER.read_text(encoding="utf-8")
        self.assertIn("^[A-Za-z][A-Za-z0-9_-]*$", text)
        self.assertIn("SDTK_MARKETING_REMOTION_CAPTURE_COMPOSITION=$capture_composition_override $SDTK_MARKETING_VIDEO_CMD_REMOTION", text)
        self.assertIn("invalid capture composition", text)

if __name__ == "__main__":
    unittest.main()
