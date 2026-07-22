from __future__ import annotations

import unittest

from test_hersocial_auto_post_runner import load_module


class TelegramContractTest(unittest.TestCase):
    def test_hermes_telegram_channel_prefix_is_removed_for_bot_api(self):
        module = load_module()
        self.assertEqual(module.telegram_chat_id("telegram:123456"), "123456")

    def test_plain_chat_id_is_preserved(self):
        module = load_module()
        self.assertEqual(module.telegram_chat_id("-100123456"), "-100123456")

    def test_empty_chat_id_fails_closed(self):
        module = load_module()
        with self.assertRaisesRegex(module.DeliveryFailure, "telegram_configuration_missing"):
            module.telegram_chat_id("")


if __name__ == "__main__":
    unittest.main()
