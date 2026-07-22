#!/usr/bin/env python3
"""Deterministic, owner-approved Facebook Page scheduler for HerSocial."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable


DEFAULT_POSTS_DIR = Path("/workspace/hermes-agent-plugin/control-plane/hersocial-auto-post/posts")
DEFAULT_STATE_PATH = Path("/opt/data/hermes/control-plane/hersocial-auto-post/state.json")
TERMINAL_STATUSES = {"adopted", "published", "partial", "failed", "blocked"}
SCHEMA_VERSION = "hersocial.facebook-post.v1"


class AutoPostFailure(RuntimeError):
    """A safe operator-facing failure code with no credential material."""


class GraphFailure(AutoPostFailure):
    """A sanitized Facebook Graph API failure."""


class DeliveryFailure(AutoPostFailure):
    """The deterministic Telegram report could not be delivered."""


def _canonical_content(manifest: dict) -> dict:
    return {
        "schema_version": manifest.get("schema_version"),
        "post_key": manifest.get("post_key"),
        "scheduled_at": manifest.get("scheduled_at"),
        "max_lateness_minutes": manifest.get("max_lateness_minutes"),
        "message": manifest.get("message"),
        "first_comment": manifest.get("first_comment"),
        "media_path": manifest.get("media_path"),
        "media_sha256": manifest.get("media_sha256"),
        "media_kind": manifest.get("media_kind"),
        "source_document": manifest.get("source_document"),
    }


def content_digest(manifest: dict) -> str:
    encoded = json.dumps(
        _canonical_content(manifest), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _parse_schedule(value: object) -> datetime:
    if not isinstance(value, str) or not value:
        raise AutoPostFailure("schedule_missing")
    try:
        scheduled = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise AutoPostFailure("schedule_invalid") from error
    if scheduled.tzinfo is None:
        raise AutoPostFailure("schedule_timezone_missing")
    return scheduled.astimezone(timezone.utc)


def validate_manifest(manifest: dict, *, now: datetime) -> dict:
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise AutoPostFailure("schema_version_invalid")
    post_key = manifest.get("post_key")
    if not isinstance(post_key, str) or not post_key:
        raise AutoPostFailure("post_key_missing")
    if manifest.get("status") != "approved":
        raise AutoPostFailure("manifest_not_approved")
    message = manifest.get("message")
    first_comment = manifest.get("first_comment")
    if not isinstance(message, str) or not message.strip():
        raise AutoPostFailure("message_missing")
    if not isinstance(first_comment, str) or not first_comment.strip():
        raise AutoPostFailure("first_comment_missing")
    approval = manifest.get("approval")
    if not isinstance(approval, dict) or approval.get("approved_by") != "owner":
        raise AutoPostFailure("owner_approval_missing")
    expected_digest = approval.get("approved_content_sha256")
    actual_digest = content_digest(manifest)
    if expected_digest != actual_digest:
        raise AutoPostFailure("approval_digest_mismatch")

    media_kind = manifest.get("media_kind")
    if media_kind == "video":
        raise AutoPostFailure("video_not_supported")
    if media_kind not in {"none", "image"}:
        raise AutoPostFailure("media_kind_invalid")
    media_path = manifest.get("media_path")
    if media_kind == "image":
        if not isinstance(media_path, str) or not Path(media_path).is_file():
            raise AutoPostFailure("media_missing")
    elif media_path not in {None, ""}:
        raise AutoPostFailure("media_path_unexpected")

    scheduled = _parse_schedule(manifest.get("scheduled_at"))
    lateness_value = manifest.get("max_lateness_minutes")
    if not isinstance(lateness_value, int) or lateness_value < 0 or lateness_value > 1440:
        raise AutoPostFailure("max_lateness_invalid")
    if now.astimezone(timezone.utc) > scheduled + timedelta(minutes=lateness_value):
        raise AutoPostFailure("schedule_too_late")
    return {"post_key": post_key, "scheduled_at": scheduled, "content_sha256": actual_digest}


class FacebookGraphClient:
    def __init__(self, *, page_id: str, access_token: str, timeout_seconds: int = 20) -> None:
        self.page_id = page_id
        self.access_token = access_token
        self.timeout_seconds = timeout_seconds
        self.api_base = "https://graph.facebook.com/v21.0"

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict:
        query = dict(params or {})
        query["access_token"] = self.access_token
        url = f"{self.api_base}/{path.lstrip('/')}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            raise GraphFailure(f"graph_http_{error.code}") from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise GraphFailure("graph_transport_error") from error
        if not isinstance(payload, dict):
            raise GraphFailure("graph_payload_invalid")
        if "error" in payload:
            raise GraphFailure("graph_api_error")
        return payload

    def health(self) -> dict:
        payload = self._request_json("GET", self.page_id, params={"fields": "id,name"})
        return {"ok": bool(payload.get("id")), "page_name": payload.get("name")}

    def find_exact_post(self, message: str) -> dict | None:
        payload = self._request_json(
            "GET",
            f"{self.page_id}/posts",
            params={"fields": "message,created_time,permalink_url", "limit": "100"},
        )
        for post in payload.get("data", []):
            if isinstance(post, dict) and post.get("message") == message:
                return {
                    "post_id": post.get("id"),
                    "permalink_url": post.get("permalink_url"),
                }
        return None

    @staticmethod
    def _multipart(media_path: Path, fields: dict[str, str]) -> tuple[bytes, str]:
        boundary = f"----hersocial-{secrets.token_hex(12)}"
        chunks: list[bytes] = []
        for name, value in fields.items():
            chunks.extend(
                [
                    f"--{boundary}\r\n".encode(),
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                    value.encode("utf-8"),
                    b"\r\n",
                ]
            )
        media_type = mimetypes.guess_type(media_path.name)[0] or "application/octet-stream"
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="source"; filename="{media_path.name}"\r\n'
                    f"Content-Type: {media_type}\r\n\r\n"
                ).encode(),
                media_path.read_bytes(),
                b"\r\n",
                f"--{boundary}--\r\n".encode(),
            ]
        )
        return b"".join(chunks), f"multipart/form-data; boundary={boundary}"

    def publish(self, *, message: str, media_path: str | None) -> dict:
        if media_path:
            body, content_type = self._multipart(Path(media_path), {"caption": message})
            payload = self._request_json(
                "POST", f"{self.page_id}/photos", data=body, headers={"Content-Type": content_type}
            )
            post_id = payload.get("post_id") or payload.get("id")
        else:
            body = urllib.parse.urlencode({"message": message}).encode()
            payload = self._request_json(
                "POST",
                f"{self.page_id}/feed",
                data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            post_id = payload.get("id")
        if not isinstance(post_id, str) or not post_id:
            raise GraphFailure("graph_post_id_missing")
        return {"post_id": post_id, "permalink_url": f"https://facebook.com/{post_id}"}

    def comment(self, *, post_id: str, message: str) -> dict:
        body = urllib.parse.urlencode({"message": message}).encode()
        payload = self._request_json(
            "POST",
            f"{post_id}/comments",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        comment_id = payload.get("id")
        if not isinstance(comment_id, str) or not comment_id:
            raise GraphFailure("graph_comment_id_missing")
        return {"comment_id": comment_id}


class HerSocialAutoPostRunner:
    def __init__(
        self,
        *,
        posts_dir: Path,
        state_path: Path,
        facebook,
        notifier: Callable[[str], None],
        now: Callable[[], datetime] | None = None,
        enabled: bool = False,
    ) -> None:
        self.posts_dir = posts_dir
        self.state_path = state_path
        self.facebook = facebook
        self.notifier = notifier
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.enabled = enabled

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

    def preview(self, post_key: str) -> dict:
        manifest = self._manifest(post_key)
        validated = validate_manifest(manifest, now=self.now())
        return {
            "status": "ready",
            "post_key": post_key,
            "scheduled_at": manifest["scheduled_at"],
            "media_kind": manifest["media_kind"],
            "media_present": manifest["media_kind"] == "none" or Path(manifest["media_path"]).is_file(),
            "content_sha256": validated["content_sha256"],
            "approval_command": f"APPROVE HERSOCIAL POST {post_key} {validated['content_sha256']}",
        }

    def _record(self, post_key: str, **values) -> None:
        state = self._state()
        posts = state.setdefault("posts", {})
        record = posts.setdefault(post_key, {})
        record.update(values)
        record["updated_at"] = self.now().astimezone(timezone.utc).isoformat()
        self._save_state(state)

    def _notify(self, text: str) -> None:
        try:
            self.notifier(text)
        except Exception as error:
            raise DeliveryFailure("telegram_delivery_failed") from error

    @staticmethod
    def _report(status: str, post_key: str, permalink: str | None = None) -> str:
        lines = [f"HerSocial auto-post {status}: {post_key}"]
        if permalink:
            lines.append(permalink)
        return "\n".join(lines)

    def run_once(self) -> dict:
        if not self.enabled:
            return {"status": "disabled"}
        now = self.now().astimezone(timezone.utc)
        state = self._state()
        for manifest in self._manifests():
            post_key = str(manifest.get("post_key", "unknown"))
            prior = state.get("posts", {}).get(post_key, {})
            if prior.get("status") in TERMINAL_STATUSES:
                continue
            try:
                scheduled = _parse_schedule(manifest.get("scheduled_at"))
                if scheduled > now:
                    continue
                validated = validate_manifest(manifest, now=now)
            except AutoPostFailure as error:
                self._record(post_key, status="blocked", reason=str(error))
                self._notify(self._report("BLOCKED", post_key))
                return {"status": "blocked", "post_key": post_key, "reason": str(error)}

            try:
                existing = self.facebook.find_exact_post(manifest["message"])
            except GraphFailure:
                self._record(post_key, status="failed", reason="facebook_reconcile_failed")
                self._notify(self._report("FAILED", post_key))
                return {"status": "failed", "post_key": post_key, "reason": "facebook_reconcile_failed"}
            if existing:
                self._record(
                    post_key,
                    status="adopted",
                    content_sha256=validated["content_sha256"],
                    facebook_post_id=existing.get("post_id"),
                    permalink_url=existing.get("permalink_url"),
                )
                self._notify(self._report("ADOPTED", post_key, existing.get("permalink_url")))
                return {"status": "adopted", "post_key": post_key, **existing}

            self._record(post_key, status="attempting", content_sha256=validated["content_sha256"])
            try:
                published = self.facebook.publish(
                    message=manifest["message"],
                    media_path=manifest.get("media_path") or None,
                )
            except GraphFailure:
                self._record(post_key, status="failed", reason="facebook_publish_failed")
                self._notify(self._report("FAILED", post_key))
                return {"status": "failed", "post_key": post_key}

            self._record(
                post_key,
                status="published_primary",
                facebook_post_id=published["post_id"],
                permalink_url=published.get("permalink_url"),
            )
            try:
                comment = self.facebook.comment(
                    post_id=published["post_id"], message=manifest["first_comment"]
                )
            except GraphFailure:
                self._record(post_key, status="partial", reason="first_comment_failed")
                self._notify(self._report("PARTIAL", post_key, published.get("permalink_url")))
                return {"status": "partial", "post_key": post_key, **published}

            self._record(post_key, status="published", facebook_comment_id=comment["comment_id"])
            self._notify(self._report("PUBLISHED", post_key, published.get("permalink_url")))
            return {"status": "published", "post_key": post_key, **published}
        return {"status": "no_op"}

    def run_forever(self, poll_seconds: int) -> None:
        while True:
            result = self.run_once()
            print(json.dumps({"event": "hersocial_auto_post_tick", **result}), flush=True)
            time.sleep(max(5, poll_seconds))


def telegram_chat_id(value: str) -> str:
    if not value:
        raise DeliveryFailure("telegram_configuration_missing")
    if value.startswith("telegram:"):
        value = value.split(":", 1)[1]
    if not value:
        raise DeliveryFailure("telegram_configuration_missing")
    return value


def _send_telegram(text: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    raw_chat_id = os.environ.get("TELEGRAM_HOME_CHANNEL", "")
    if not token:
        raise DeliveryFailure("telegram_configuration_missing")
    chat_id = telegram_chat_id(raw_chat_id)
    body = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=body, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status >= 300:
                raise DeliveryFailure("telegram_non_success")
    except Exception as error:
        raise DeliveryFailure("telegram_delivery_failed") from error


def _enabled_from_env() -> bool:
    return os.environ.get("HERSOCIAL_AUTO_POST_ENABLED", "false").lower() == "true"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run deterministic HerSocial Facebook auto-posting.")
    parser.add_argument("--posts-dir", type=Path, default=DEFAULT_POSTS_DIR)
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--poll-seconds", type=int, default=30)
    parser.add_argument("--run-once", action="store_true")
    parser.add_argument("--preview")
    args = parser.parse_args()

    facebook = FacebookGraphClient(
        page_id=os.environ.get("FACEBOOK_PAGE_ID", ""),
        access_token=os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN", ""),
    )
    runner = HerSocialAutoPostRunner(
        posts_dir=args.posts_dir,
        state_path=args.state_path,
        facebook=facebook,
        notifier=_send_telegram,
        enabled=_enabled_from_env(),
    )
    try:
        if args.preview:
            print(json.dumps(runner.preview(args.preview), ensure_ascii=False, indent=2))
        elif args.run_once:
            print(json.dumps(runner.run_once(), ensure_ascii=False, indent=2))
        else:
            runner.run_forever(args.poll_seconds)
    except AutoPostFailure as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
