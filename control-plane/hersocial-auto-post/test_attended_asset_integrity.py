from __future__ import annotations

import hashlib
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


def load_module():
    module_path = Path(__file__).with_name("hersocial_attended_runner.py")
    sys.path.insert(0, str(module_path.parent))
    spec = importlib.util.spec_from_file_location("hersocial_attended_asset_integrity", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AttendedAssetIntegrityTest(unittest.TestCase):
    def test_image_bytes_must_match_manifest_hash(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            asset = Path(temporary) / "asset.png"
            asset.write_bytes(b"approved-image")
            manifest = {
                "schema_version": "hersocial.facebook-post.v1",
                "post_key": "post-five",
                "status": "ready_for_owner_approval",
                "scheduled_at": "2026-07-24T09:00:00+07:00",
                "message": "copy",
                "first_comment": "comment",
                "media_path": str(asset),
                "media_kind": "image",
                "media_sha256": hashlib.sha256(asset.read_bytes()).hexdigest(),
                "source_document": "post5.md",
            }
            module.HerSocialAttendedRunner._validate_ready(manifest)
            asset.write_bytes(b"changed-after-approval")
            with self.assertRaisesRegex(module.AutoPostFailure, "media_sha256_mismatch"):
                module.HerSocialAttendedRunner._validate_ready(manifest)


if __name__ == "__main__":
    unittest.main()
