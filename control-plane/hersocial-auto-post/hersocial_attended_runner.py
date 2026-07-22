#!/usr/bin/env python3
"""Attended schedule reminder and exact-approval queue for HerSocial."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from hersocial_auto_post_runner import (
    AutoPostFailure,
    DEFAULT_POSTS_DIR,
    DEFAULT_STATE_PATH,
    FacebookGraphClient,
    GraphFailure,
    HerSocialAutoPostRunner,
    SCHEMA_VERSION,
    _parse_schedule,
    _send_telegram,
    content_digest,
)


READY_STATUS = "ready_for_owner_approval"
DEFAULT_MARKETING_CHECK_TIMEOUT_SECONDS = 15


class MarketingCheckUnavailable(AutoPostFailure):
    pass


class MarketingCheckBlocked(AutoPostFailure):
    def __init__(self, result: dict) -> None:
        super().__init__("marketing_check_blocked")
        self.result = result


class HerSocialAttendedRunner:
    def __init__(
        self,
        *,
        posts_dir: Path,
        state_path: Path,
        facebook,
        notifier,
        now=None,
        reminders_enabled: bool = True,
        marketing_check_command: str,
        marketing_check_timeout_seconds: int = DEFAULT_MARKETING_CHECK_TIMEOUT_SECONDS,
    ) -> None:
        self.posts_dir = posts_dir
        self.state_path = state_path
        self.facebook = facebook
        self.notifier = notifier
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.reminders_enabled = reminders_enabled
        self.marketing_check_command = marketing_check_command
        self.marketing_check_timeout_seconds = marketing_check_timeout_seconds

    def _state(self) -> dict:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {"posts": {}}
        except (FileNotFoundError, json.JSONDecodeError):
            return {"posts": {}}

    def _save_state(self, state: dict) -> None:
        self.state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.state_path.parent, 0o700)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_path)

    def _record(self, post_key: str, **values) -> None:
        state = self._state()
        record = state.setdefault("posts", {}).setdefault(post_key, {})
        record.update(values)
        record["updated_at"] = self.now().astimezone(timezone.utc).isoformat()
        self._save_state(state)

    def _manifests(self) -> list[dict]:
        manifests = []
        for path in sorted(self.posts_dir.glob("*.json")):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise AutoPostFailure("manifest_unreadable") from error
            if not isinstance(value, dict):
                raise AutoPostFailure("manifest_invalid")
            manifests.append(value)
        return manifests

    def _manifest(self, post_key: str) -> dict:
        for manifest in self._manifests():
            if manifest.get("post_key") == post_key:
                return manifest
        raise AutoPostFailure("post_key_unknown")

    @staticmethod
    def _validate_ready(manifest: dict) -> dict:
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise AutoPostFailure("schema_version_invalid")
        if manifest.get("status") != READY_STATUS:
            raise AutoPostFailure("manifest_not_ready_for_owner_approval")
        for field in ("post_key", "message", "first_comment", "source_document"):
            if not isinstance(manifest.get(field), str) or not manifest[field].strip():
                raise AutoPostFailure(f"{field}_missing")
        _parse_schedule(manifest.get("scheduled_at"))
        media_kind = manifest.get("media_kind")
        if media_kind == "video":
            raise AutoPostFailure("video_not_supported")
        if media_kind not in {"none", "image"}:
            raise AutoPostFailure("media_kind_invalid")
        media_path = manifest.get("media_path")
        if media_kind == "image" and (not isinstance(media_path, str) or not Path(media_path).is_file()):
            raise AutoPostFailure("media_missing")
        if media_kind == "image":
            expected_media_sha = manifest.get("media_sha256")
            if not isinstance(expected_media_sha, str) or len(expected_media_sha) != 64:
                raise AutoPostFailure("media_sha256_missing")
            actual_media_sha = __import__("hashlib").sha256(Path(media_path).read_bytes()).hexdigest()
            if actual_media_sha != expected_media_sha:
                raise AutoPostFailure("media_sha256_mismatch")
        if media_kind == "none" and media_path not in {None, ""}:
            raise AutoPostFailure("media_path_unexpected")
        return {"content_sha256": content_digest(manifest)}

    @staticmethod
    def _publishable_copy(manifest: dict) -> str:
        return f"{manifest['message']}\n\n{manifest['first_comment']}"

    def _marketing_check(self, manifest: dict) -> dict:
        try:
            command = shlex.split(self.marketing_check_command)
        except ValueError as error:
            raise MarketingCheckUnavailable("marketing_check_command_invalid") from error
        if not command:
            raise MarketingCheckUnavailable("marketing_check_command_missing")
        try:
            completed = subprocess.run(
                [*command, "check", "--stdin", "--json"],
                input=self._publishable_copy(manifest), text=True, capture_output=True,
                timeout=self.marketing_check_timeout_seconds, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise MarketingCheckUnavailable("marketing_check_unavailable") from error
        try:
            result = json.loads(completed.stdout)
            errors, warnings, findings = result["errors"], result["warnings"], result["findings"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise MarketingCheckUnavailable("marketing_check_output_invalid") from error
        if (not isinstance(errors, int) or isinstance(errors, bool) or errors < 0
                or not isinstance(warnings, int) or isinstance(warnings, bool) or warnings < 0
                or not isinstance(findings, list)):
            raise MarketingCheckUnavailable("marketing_check_output_invalid")
        if completed.returncode not in {0, 1}:
            raise MarketingCheckUnavailable("marketing_check_unavailable")
        if (completed.returncode == 1) != (errors > 0):
            raise MarketingCheckUnavailable("marketing_check_exit_mismatch")
        normalized = {"errors": errors, "warnings": warnings, "findings": findings}
        if errors:
            raise MarketingCheckBlocked(normalized)
        return normalized

    @staticmethod
    def _finding_lines(findings: list, *, limit: int = 10) -> list[str]:
        lines = []
        for finding in findings[:limit]:
            if not isinstance(finding, dict):
                continue
            rule = str(finding.get("rule") or "unknown-rule").replace("\n", " ")[:80]
            message = str(finding.get("message") or "finding").replace("\n", " ")[:240]
            lines.append(f"- {rule}: {message}")
        if len(findings) > limit:
            lines.append(f"- ... {len(findings) - limit} finding(s) omitted")
        return lines

    @classmethod
    def _approval_packet(cls, manifest: dict, digest: str, check_result: dict) -> str:
        if check_result["warnings"]:
            check_section = (f"MARKETING CHECK: PASS WITH {check_result['warnings']} WARNING(S)\n"
                             + "\n".join(cls._finding_lines(check_result["findings"])) + "\n")
        else:
            check_section = "MARKETING CHECK: PASS (0 errors, 0 warnings)\n"
        return (
            "HerSocial scheduled post requires owner approval\n"
            f"schedule: {manifest['scheduled_at']}\n"
            f"post_key: {manifest['post_key']}\n\n"
            "PAGE COPY (exact):\n"
            f"{manifest['message']}\n\n"
            "FIRST COMMENT (exact):\n"
            f"{manifest['first_comment']}\n\n"
            f"ASSET: {manifest.get('media_path') or 'none'}\n"
            f"ASSET SHA256: {manifest.get('media_sha256') or 'none'}\n"
            f"{check_section}"
            f"APPROVE HERSOCIAL POST {manifest['post_key']} {digest}"
        )

    def _notify_check_block(self, manifest: dict, status: str, message: str, findings: list) -> None:
        post_key = str(manifest.get("post_key") or "unknown")
        digest = content_digest(manifest)
        fingerprint = hashlib.sha256(json.dumps(
            {"status": status, "message": message, "findings": findings, "digest": digest},
            ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        record = self._state().get("posts", {}).get(post_key, {})
        if record.get("check_block_fingerprint") != fingerprint:
            self.notifier("\n".join([message, *self._finding_lines(findings)]))
        self._record(post_key, status=status, content_sha256=digest,
                     check_block_fingerprint=fingerprint)

    def _gate_or_report(self, manifest: dict) -> dict | None:
        post_key = str(manifest.get("post_key") or "unknown")
        try:
            return self._marketing_check(manifest)
        except MarketingCheckBlocked as error:
            self._notify_check_block(manifest, "check_blocked",
                f"post {post_key} bị check chặn: {error.result['errors']} lỗi",
                error.result["findings"])
            return None
        except MarketingCheckUnavailable:
            self._notify_check_block(manifest, "check_unavailable",
                f"post {post_key} bị chặn: check unavailable", [])
            return None

    def preview(self, post_key: str) -> dict:
        manifest = self._manifest(post_key)
        digest = self._validate_ready(manifest)["content_sha256"]
        check_result = self._marketing_check(manifest)
        return {
            "status": "ready_for_owner_approval",
            "post_key": post_key,
            "scheduled_at": manifest["scheduled_at"],
            "message": manifest["message"],
            "first_comment": manifest["first_comment"],
            "media_path": manifest.get("media_path"),
            "media_sha256": manifest.get("media_sha256"),
            "content_sha256": digest,
            "marketing_check": check_result,
            "approval_command": f"APPROVE HERSOCIAL POST {post_key} {digest}",
        }

    def record_approval(self, post_key: str, digest: str) -> dict:
        manifest = self._manifest(post_key)
        expected = self._validate_ready(manifest)["content_sha256"]
        self._marketing_check(manifest)
        if digest != expected:
            raise AutoPostFailure("approval_digest_mismatch")
        record = self._state().get("posts", {}).get(post_key, {})
        if record.get("status") in {"published", "adopted", "partial"}:
            raise AutoPostFailure("post_already_terminal")
        self._record(post_key, status="approved_pending_publish", content_sha256=digest)
        return {"status": "approved_pending_publish", "post_key": post_key, "content_sha256": digest}

    def _publish_approved(self, manifest: dict, digest: str) -> dict:
        transient = dict(manifest)
        transient["status"] = "approved"
        transient["approval"] = {"approved_by": "owner", "approved_content_sha256": digest}
        temporary_dir = self.state_path.parent / "approved-manifests"
        temporary_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(temporary_dir, 0o700)
        temporary_path = temporary_dir / f"{manifest['post_key']}.json"
        temporary_path.write_text(json.dumps(transient, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(temporary_path, 0o600)
        publisher = HerSocialAutoPostRunner(
            posts_dir=temporary_dir,
            state_path=self.state_path,
            facebook=self.facebook,
            notifier=self.notifier,
            now=self.now,
            enabled=True,
        )
        return publisher.run_once()

    def run_attended_once(self) -> dict:
        state = self._state()
        for manifest in self._manifests():
            post_key = str(manifest.get("post_key") or "unknown")
            record = state.get("posts", {}).get(post_key, {})
            if record.get("status") == "approved_pending_publish":
                validated = self._validate_ready(manifest)
                if record.get("content_sha256") != validated["content_sha256"]:
                    self._record(post_key, status="blocked", reason="approval_digest_mismatch")
                    return {"status": "blocked", "post_key": post_key, "reason": "approval_digest_mismatch"}
                if _parse_schedule(manifest["scheduled_at"]) > self.now().astimezone(timezone.utc):
                    return {"status": "approved_waiting_for_schedule", "post_key": post_key}
                if self._gate_or_report(manifest) is None:
                    return {"status": self._state()["posts"][post_key]["status"], "post_key": post_key}
                return self._publish_approved(manifest, validated["content_sha256"])

        if not self.reminders_enabled:
            return {"status": "disabled"}
        now = self.now().astimezone(timezone.utc)
        for manifest in self._manifests():
            post_key = str(manifest.get("post_key") or "unknown")
            record = state.get("posts", {}).get(post_key, {})
            if record.get("status") in {"approval_requested", "published", "adopted", "partial", "blocked"}:
                continue
            validated = self._validate_ready(manifest)
            if _parse_schedule(manifest["scheduled_at"]) > now:
                continue
            check_result = self._gate_or_report(manifest)
            if check_result is None:
                return {"status": self._state()["posts"][post_key]["status"], "post_key": post_key}
            packet = self._approval_packet(manifest, validated["content_sha256"], check_result)
            self.notifier(packet)
            self._record(post_key, status="approval_requested", content_sha256=validated["content_sha256"])
            return {"status": "approval_requested", "post_key": post_key}
        return {"status": "no_op"}

    def run_forever(self, poll_seconds: int) -> None:
        while True:
            try:
                result = self.run_attended_once()
            except (AutoPostFailure, GraphFailure) as error:
                result = {"status": "blocked", "reason": str(error)}
            print(json.dumps({"event": "hersocial_attended_tick", **result}), flush=True)
            time.sleep(max(5, poll_seconds))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run attended HerSocial scheduling.")
    parser.add_argument("--posts-dir", type=Path, default=DEFAULT_POSTS_DIR)
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--poll-seconds", type=int, default=30)
    parser.add_argument("--run-once", action="store_true")
    parser.add_argument("--preview")
    parser.add_argument("--record-approval", nargs=2, metavar=("POST_KEY", "SHA256"))
    args = parser.parse_args()
    runner = HerSocialAttendedRunner(
        posts_dir=args.posts_dir,
        state_path=args.state_path,
        facebook=FacebookGraphClient(
            page_id=os.environ.get("FACEBOOK_PAGE_ID", ""),
            access_token=os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN", ""),
        ),
        notifier=_send_telegram,
        reminders_enabled=os.environ.get("HERSOCIAL_ATTENDED_REMINDERS_ENABLED", "true").lower() == "true",
        marketing_check_command=os.environ.get("HERSOCIAL_MARKETING_CHECK_COMMAND", ""),
        marketing_check_timeout_seconds=int(os.environ.get(
            "HERSOCIAL_MARKETING_CHECK_TIMEOUT_SECONDS", str(DEFAULT_MARKETING_CHECK_TIMEOUT_SECONDS))),
    )
    try:
        if args.preview:
            result = runner.preview(args.preview)
        elif args.record_approval:
            result = runner.record_approval(*args.record_approval)
        elif args.run_once:
            result = runner.run_attended_once()
        else:
            runner.run_forever(args.poll_seconds)
            return 0
    except AutoPostFailure as error:
        result = {"status": "blocked", "reason": str(error)}
        print(json.dumps(result))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
