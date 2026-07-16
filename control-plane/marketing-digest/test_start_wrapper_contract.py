from pathlib import Path
import unittest


class StartWrapperContractTest(unittest.TestCase):
    def test_only_forwards_configured_optional_values(self) -> None:
        wrapper = Path(__file__).with_name("start-marketing-digest.sh").read_text(encoding="utf-8")
        self.assertIn('if [[ -n "${!name:-}" ]]', wrapper)
        self.assertIn('env_args+=("$name=${!name}")', wrapper)
        self.assertNotIn('MKT_NPM_PACKAGES="${MKT_NPM_PACKAGES:-}"', wrapper)


if __name__ == "__main__":
    unittest.main()
