#!/usr/bin/env python3
"""Deterministic weekly BK-M1 scheduler and verbatim Telegram transport."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo


TOKYO = ZoneInfo("Asia/Tokyo")
SCHEDULE_WEEKDAY = 0
SCHEDULE_HOUR = 10
SCHEDULE_LABEL = "Monday 08:00 Asia/Ho_Chi_Minh (= Monday 10:00 Asia/Tokyo)"
DEFAULT_MIRROR = Path("/opt/data/hermes/control-plane/mirrors/sdtk-internal")
DEFAULT_STATE = Path("/opt/data/hermes/control-plane/marketing-digest/state.json")
DEFAULT_DIGEST_RELATIVE = Path("scripts/ops/marketing_digest.py")
MKT_ENV_NAMES = (
    "PLAUSIBLE_API_KEY",
    "PLAUSIBLE_SITE_ID",
    "FB_PAGE_TOKEN",
    "FB_PAGE_ID",
    "LEMONSQUEEZY_API_KEY",
    "MKT_NPM_PACKAGES",
    "MKT_GITHUB_REPO",
)


class DigestFailure(RuntimeError):
    """A safe owner-facing failure reason that contains no credentials."""


class DeliveryFailure(DigestFailure):
    """Telegram delivery failed after the single permitted retry."""


class MarketingDigestRunner:
    def __init__(
        self,
        *,
        mirror_path: Path,
        state_path: Path,
        digest_script: Path | None = None,
        notifier: Callable[[str], None] | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.mirror_path = mirror_path
        self.state_path = state_path
        self.state_dir = state_path.parent
        self.digest_script = digest_script
        self.notifier = notifier or self._send_telegram
        self.now = now or (lambda: datetime.now(timezone.utc))

    def state(self) -> dict:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save_state(self, value: dict) -> None:
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.state_dir, 0o700)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_path)

    @staticmethod
    def _local_date(now: datetime) -> str:
        return now.astimezone(TOKYO).date().isoformat()

    def is_due(self, now: datetime | None = None) -> bool:
        local = (now or self.now()).astimezone(TOKYO)
        return local.weekday() == SCHEDULE_WEEKDAY and local.hour >= SCHEDULE_HOUR

    def run_scheduled_if_due(self) -> bool:
        now = self.now()
        state = self.state()
        today = self._local_date(now)
        if not self.is_due(now) or state.get("last_scheduled_attempt_local_date") == today:
            return False
        self.run_once(reason="scheduled")
        return True

    def _base_env(self) -> dict[str, str]:
        return {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(self.state_dir / "home"),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "TZ": "Asia/Tokyo",
        }

    def _git_env(self) -> dict[str, str]:
        token = os.environ.get("UC1_GITHUB_TOKEN")
        if not token:
            raise DigestFailure("GitHub read-only token unavailable")
        askpass = Path(__file__).parents[1] / "nightly-watch" / "git_askpass.sh"
        if not askpass.is_file():
            raise DigestFailure("GitHub read-only authentication helper unavailable")
        return {
            **self._base_env(),
            "GH_TOKEN": token,
            "UC1_GITHUB_TOKEN": token,
            "GIT_ASKPASS": str(askpass),
            "GIT_TERMINAL_PROMPT": "0",
        }

    def _digest_env(self) -> dict[str, str]:
        env = self._base_env()
        for name in MKT_ENV_NAMES:
            value = os.environ.get(name)
            if value is not None:
                env[name] = value
        return env

    @staticmethod
    def _command(
        args: list[str], *, cwd: Path, env: dict[str, str]
    ) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                args,
                cwd=str(cwd),
                env=env,
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise DigestFailure("required command unavailable") from error

    def _prepare_mirror(self) -> None:
        if not (self.mirror_path / ".git").is_dir():
            raise DigestFailure("read-only mirror unavailable")
        # Best effort by packet contract. Absence of the script is reported below.
        self._command(
            ["git", "pull", "--ff-only", "-q"],
            cwd=self.mirror_path,
            env=self._git_env(),
        )

    def _run_digest(self) -> tuple[int, str]:
        script = self.digest_script or (self.mirror_path / DEFAULT_DIGEST_RELATIVE)
        if not script.is_file():
            raise DigestFailure("marketing digest script unavailable")
        result = self._command(
            [sys.executable, str(script)], cwd=self.mirror_path, env=self._digest_env()
        )
        if result.returncode not in (0, 1):
            raise DigestFailure("marketing digest script failed")
        if not result.stdout:
            raise DigestFailure("marketing digest produced no output")
        return result.returncode, result.stdout

    @staticmethod
    def _safe_failure(error: Exception) -> str:
        reason = str(error).splitlines()[0] if str(error) else "unknown runner failure"
        return f"marketing digest FAILED to run: {reason}"

    def _send_telegram(self, text: str) -> None:
        token = os.environ.get("TELEGRAM_BOT_TOKEN")
        chat_id = os.environ.get("TELEGRAM_HOME_CHANNEL")
        if not token or not chat_id:
            raise DigestFailure("validated Telegram notifier configuration unavailable")
        data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=data, method="POST"
        )
        last_error: Exception | None = None
        for _attempt in range(2):
            try:
                with urllib.request.urlopen(request, timeout=15) as response:
                    if response.status < 300:
                        return
                last_error = RuntimeError("Telegram returned non-success")
            except Exception as error:
                last_error = error
        raise DeliveryFailure("Telegram delivery failed after one retry") from last_error

    def run_once(self, *, reason: str) -> None:
        now = self.now()
        state = self.state()
        state["last_attempt_local_date"] = self._local_date(now)
        state["last_attempt_reason"] = reason
        state["last_attempt_at"] = now.isoformat()
        if reason == "scheduled":
            state["last_scheduled_attempt_local_date"] = self._local_date(now)
        self._save_state(state)
        try:
            self._prepare_mirror()
            exit_code, digest = self._run_digest()
            self.notifier(digest)
            state = self.state()
            state["last_successful_delivery_at"] = self.now().isoformat()
            state["last_delivery_local_date"] = self._local_date(self.now())
            state["last_digest_exit_code"] = exit_code
            self._save_state(state)
            print(json.dumps({"event": "marketing_digest_delivered", "reason": reason, "exit_code": exit_code}), flush=True)
        except DeliveryFailure:
            print(json.dumps({"event": "marketing_digest_transport_failed", "reason": reason}), flush=True)
        except Exception as error:
            safe_error = error if isinstance(error, DigestFailure) else DigestFailure("unexpected runner failure")
            try:
                self.notifier(self._safe_failure(safe_error))
                print(json.dumps({"event": "marketing_digest_failure_delivered", "reason": reason}), flush=True)
            except DigestFailure:
                print(json.dumps({"event": "marketing_digest_transport_failed", "reason": reason}), flush=True)

    def run_forever(self, poll_seconds: int) -> None:
        while True:
            self.run_scheduled_if_due()
            time.sleep(max(1, poll_seconds))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the deterministic BK-M1 marketing digest.")
    parser.add_argument("--mirror-path", type=Path, default=DEFAULT_MIRROR)
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--digest-script", type=Path)
    parser.add_argument("--poll-seconds", type=int, default=15)
    parser.add_argument("--run-once", action="store_true")
    args = parser.parse_args()
    runner = MarketingDigestRunner(
        mirror_path=args.mirror_path,
        state_path=args.state_path,
        digest_script=args.digest_script,
    )
    if args.run_once:
        runner.run_once(reason="manual")
    else:
        runner.run_forever(args.poll_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
