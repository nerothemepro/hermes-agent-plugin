from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "marketing" / "social-copy-delegate.py"


SPEC = importlib.util.spec_from_file_location("social_copy_delegate", SCRIPT)
DELEGATE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(DELEGATE)


class CompletionHandler(BaseHTTPRequestHandler):
    response_content = ""
    paths: list[str] = []
    authorization: list[str | None] = []

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        self.__class__.paths.append(self.path)
        self.__class__.authorization.append(self.headers.get("Authorization"))
        payload = {"choices": [{"message": {"content": self.__class__.response_content}}]}
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *_args):
        pass


class SocialCopyDelegateTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), CompletionHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        CompletionHandler.paths = []
        CompletionHandler.authorization = []
        self.temp = tempfile.TemporaryDirectory()
        self.input = Path(self.temp.name) / "source.json"
        self.output = Path(self.temp.name) / "candidate.json"
        self.source = {
            "schema_version": "sdtk.marketing-social-source.v1",
            "project_id": "preview-studio-ep1",
            "identity_sha256": "a" * 64,
            "language": "en",
            "allowed_claims": [{"id": "C01", "claim": "Preview Studio records scoped feedback."}],
            "platforms": ["x"],
            "angles": ["proof"],
        }
        self.input.write_text(json.dumps(self.source), encoding="utf-8")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def run_delegate(self):
        env = {
            "PATH": os.environ["PATH"],
            "LMSTUDIO_BASE_URL": f"http://127.0.0.1:{self.server.server_port}",
            "LLM_DEFAULT_MODEL": "local-test-model",
            "LM_API_KEY": "test-token-must-not-appear",
        }
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--input", str(self.input), "--output", str(self.output)],
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    def test_writes_atomic_candidate_contract_without_logging_key(self):
        CompletionHandler.response_content = json.dumps({
            "canonical_concept": "Precise review makes agent fixes easier to verify.",
            "variants": [{
                "variant_id": "x-proof-01",
                "platform": "x",
                "angle": "proof",
                "language": "en",
                "format": "single",
                "posts": ["Scoped feedback makes the requested change reviewable."],
                "claim_refs": ["C01"],
            }],
        })
        result = self.run_delegate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("test-token-must-not-appear", result.stdout + result.stderr)
        self.assertEqual(CompletionHandler.paths, ["/v1/chat/completions"])
        self.assertEqual(CompletionHandler.authorization, ["Bearer test-token-must-not-appear"])
        candidate = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(candidate["project_id"], self.source["project_id"])
        self.assertEqual(candidate["source_identity_sha256"], self.source["identity_sha256"])
        self.assertEqual(candidate["language"], "en")
        self.assertEqual(oct(self.output.stat().st_mode & 0o777), "0o600")

    def test_invalid_model_payload_fails_without_output(self):
        CompletionHandler.response_content = "not-json"
        result = self.run_delegate()
        self.assertEqual(result.returncode, 1)
        self.assertIn("model response", result.stderr)
        self.assertFalse(self.output.exists())


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
