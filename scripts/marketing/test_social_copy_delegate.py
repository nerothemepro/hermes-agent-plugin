#!/usr/bin/env python3
"""Regression checks for the local social-copy delegate output-contract prompt."""

import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("social-copy-delegate.py")
SPEC = importlib.util.spec_from_file_location("social_copy_delegate", MODULE_PATH)
DELEGATE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(DELEGATE)


class PromptContractTest(unittest.TestCase):
    def test_prompt_embeds_complete_platform_contract(self):
        source = {
            "platforms": ["x", "facebook", "youtube"],
            "angles": ["pain", "proof", "workflow"],
            "allowed_claims": [{"id": "CL01"}, {"id": "CL02"}, {"id": "CL03"}],
        }
        prompt = DELEGATE.prompt_for(source)
        template = json.loads(prompt.split("Required output template:\n", 1)[1].split("\nSource pack:\n", 1)[0])
        self.assertEqual(len(template["variants"]), 9)
        x = next(item for item in template["variants"] if item["variant_id"] == "x-pain")
        facebook = next(item for item in template["variants"] if item["variant_id"] == "facebook-proof")
        youtube = next(item for item in template["variants"] if item["variant_id"] == "youtube-workflow")
        self.assertEqual(x["posts"], ["WRITE ONE ENGLISH X POST HERE"])
        self.assertEqual(facebook["format"], "video_post")
        self.assertIn("page_copy", facebook)
        self.assertNotIn("video_post", facebook)
        self.assertEqual(youtube["tags"], ["SDTK"])
        self.assertEqual(x["claim_refs"], ["REPLACE_WITH_ALLOWED_CLAIM_ID_THAT_SUPPORTS_THIS_VARIANT"])
        self.assertIn("Preserve every key", prompt)

    def test_prompt_fails_closed_without_claim_ids(self):
        with self.assertRaisesRegex(ValueError, "no allowed claim IDs"):
            DELEGATE.prompt_for({"platforms": ["x"], "angles": ["pain"], "allowed_claims": []})


if __name__ == "__main__":
    unittest.main()
