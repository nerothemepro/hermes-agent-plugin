#!/usr/bin/env python3
"""Deterministic, read-only UC-1 scheduler and verbatim Telegram transport."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo


TOKYO = ZoneInfo("Asia/Tokyo")
SCHEDULE_HOUR = 9
SCHEDULE_LABEL = "09:00 Asia/Tokyo (= 07:00 Asia/Ho_Chi_Minh per packet)"
MIRROR_REPOSITORY = "https://github.com/codexsdtk/sdtk-internal.git"


class WatchFailure(RuntimeError):
    """A safe, operator-facing failure reason that cannot include credentials."""


class DeliveryFailure(WatchFailure):
    """Delivery failed after the single permitted retry."""


class NightlyWatchRunner:
    def __init__(
        self,
        *,
        mirror_path: Path,
        state_path: Path,
        notifier: Callable[[str], None] | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.mirror_path = mirror_path
        self.state_path = state_path
        self.state_dir = state_path.parent
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
        return local.hour >= SCHEDULE_HOUR

    def should_recover_missed_run(self) -> bool:
        now = self.now()
        state = self.state()
        today = self._local_date(now)
        if not self.is_due(now) or state.get("last_scheduled_attempt_local_date") == today:
            return False
        timestamp = state.get("last_successful_delivery_at")
        if not timestamp:
            return True
        try:
            delivered = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            return True
        return now - delivered > timedelta(hours=24)

    def handle_startup(self) -> None:
        if self.should_recover_missed_run():
            self.run_once(reason="startup_recovery")

    def run_scheduled_if_due(self) -> bool:
        now = self.now()
        state = self.state()
        if not self.is_due(now) or state.get("last_delivery_local_date") == self._local_date(now) or state.get("last_scheduled_attempt_local_date") == self._local_date(now):
            return False
        self.run_once(reason="scheduled")
        return True

    def _job_env(self) -> dict[str, str]:
        token = os.environ.get("UC1_GITHUB_TOKEN")
        if not token:
            raise WatchFailure("GitHub read-only token unavailable")
        path = os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        askpass = Path(__file__).with_name("git_askpass.sh")
        if not askpass.is_file():
            raise WatchFailure("GitHub read-only authentication helper unavailable")
        return {
            "PATH": path,
            "HOME": str(self.state_dir / "home"),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "GH_TOKEN": token,
            "GIT_ASKPASS": str(askpass),
            "GIT_TERMINAL_PROMPT": "0",
        }

    def _command(self, args: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                args,
                cwd=str(cwd) if cwd else None,
                env=self._job_env(),
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise WatchFailure("required command unavailable") from error

    def _prepare_mirror(self) -> None:
        if not self.mirror_path.exists():
            self.mirror_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            clone = self._command(["git", "clone", "--quiet", MIRROR_REPOSITORY, str(self.mirror_path)])
            if clone.returncode != 0:
                raise WatchFailure("mirror clone failed")
        if not (self.mirror_path / ".git").exists():
            raise WatchFailure("mirror unavailable")
        # Best effort only: nightly_watch.py independently reports freshness failures.
        self._command(["git", "pull", "--ff-only", "-q"], cwd=self.mirror_path)

    def _run_watch(self) -> tuple[int, str]:
        script = self.mirror_path / "scripts" / "ops" / "nightly_watch.py"
        if not script.is_file():
            raise WatchFailure("nightly watch script unavailable")
        result = self._command([sys.executable, str(script)], cwd=self.mirror_path)
        if result.returncode not in (0, 1):
            raise WatchFailure("nightly watch script failed")
        if not result.stdout:
            raise WatchFailure("nightly watch produced no digest")
        return result.returncode, result.stdout

    @staticmethod
    def _safe_failure(error: Exception) -> str:
        reason = str(error).splitlines()[0] if str(error) else "unknown runner failure"
        return f"nightly watch FAILED to run: {reason}"

    def _send_telegram(self, text: str) -> None:
        token = os.environ.get("TELEGRAM_BOT_TOKEN")
        chat_id = os.environ.get("TELEGRAM_HOME_CHANNEL")
        if not token or not chat_id:
            raise WatchFailure("validated Telegram notifier configuration unavailable")
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
                last_error = RuntimeError("Telegram delivery returned a non-success status")
            except Exception as error:  # transport only; never recomposes or retries the job
                last_error = error
        raise DeliveryFailure("Telegram delivery failed after one retry") from last_error

    def run_once(self, *, reason: str) -> None:
        now = self.now()
        state = self.state()
        state["last_attempt_local_date"] = self._local_date(now)
        state["last_attempt_reason"] = reason
        state["last_attempt_at"] = now.isoformat()
        if reason in ("scheduled", "startup_recovery"):
            state["last_scheduled_attempt_local_date"] = self._local_date(now)
        self._save_state(state)
        try:
            self._prepare_mirror()
            exit_code, digest = self._run_watch()
            self.notifier(digest)  # stdout is passed unchanged on both exit 0 and exit 1.
            state = self.state()
            state["last_successful_delivery_at"] = self.now().isoformat()
            state["last_delivery_local_date"] = self._local_date(self.now())
            state["last_watch_exit_code"] = exit_code
            self._save_state(state)
            print(json.dumps({"event": "nightly_watch_delivered", "reason": reason, "exit_code": exit_code}), flush=True)
        except DeliveryFailure:
            print(json.dumps({"event": "nightly_watch_transport_failed", "reason": reason}), flush=True)
        except Exception as error:
            safe_error = error if isinstance(error, WatchFailure) else WatchFailure("unexpected runner failure")
            failure = self._safe_failure(safe_error)
            try:
                self.notifier(failure)
                print(json.dumps({"event": "nightly_watch_failure_delivered", "reason": reason}), flush=True)
            except WatchFailure:
                print(json.dumps({"event": "nightly_watch_transport_failed", "reason": reason}), flush=True)

    def run_forever(self, poll_seconds: int) -> None:
        self.handle_startup()
        while True:
            self.run_scheduled_if_due()
            time.sleep(max(1, poll_seconds))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the deterministic Hermes UC-1 nightly watch.")
    parser.add_argument("--mirror-path", type=Path, default=Path("/opt/data/hermes/control-plane/mirrors/sdtk-internal"))
    parser.add_argument("--state-path", type=Path, default=Path("/opt/data/hermes/control-plane/nightly-watch/state.json"))
    parser.add_argument("--poll-seconds", type=int, default=15)
    parser.add_argument("--run-once", action="store_true", help="Run one attended validation/probe delivery now.")
    args = parser.parse_args()
    runner = NightlyWatchRunner(mirror_path=args.mirror_path, state_path=args.state_path)
    if args.run_once:
        runner.run_once(reason="manual")
    else:
        runner.run_forever(args.poll_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
