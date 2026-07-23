#!/usr/bin/env python3
"""Read-only Monday marketing measurement clock for HerSocial."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

ICT = ZoneInfo("Asia/Ho_Chi_Minh")
SCHEDULE_WEEKDAY = 0
SCHEDULE_HOUR = 8
SCHEDULE_LABEL = "Monday 08:00 Asia/Ho_Chi_Minh"
DEFAULT_STATE = Path("/opt/data/hermes/control-plane/hersocial-marketing-automation/state.json")
COMMANDS = (
    ("sdtk-marketing digest", ("sdtk-marketing", "digest")),
    ("sdtk-marketing attribution pull distribution-r2", ("sdtk-marketing", "attribution", "pull", "distribution-r2")),
    ("sdtk-marketing eval distribution-r2", ("sdtk-marketing", "eval", "distribution-r2")),
    ("sdtk-marketing report distribution-r2", ("sdtk-marketing", "report", "distribution-r2")),
)

class AutomationFailure(RuntimeError):
    pass

class MarketingAutomationRunner:
    def __init__(self, *, state_path: Path = DEFAULT_STATE, notifier: Callable[[str], None] | None = None, now: Callable[[], datetime] | None = None, command: Callable[[tuple[str, ...]], subprocess.CompletedProcess[str]] | None = None) -> None:
        self.state_path = state_path
        self.notifier = notifier or self._send_telegram
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.command = command or self._command

    def _state(self) -> dict:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save_state(self, value: dict) -> None:
        self.state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.state_path.parent, 0o700)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_path)

    def _command(self, args: tuple[str, ...]) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(args, capture_output=True, text=True, timeout=180, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise AutomationFailure("sdtk-marketing command unavailable") from error

    @staticmethod
    def _local_date(now: datetime) -> str:
        return now.astimezone(ICT).date().isoformat()

    def _is_due(self, now: datetime) -> bool:
        local = now.astimezone(ICT)
        return local.weekday() == SCHEDULE_WEEKDAY and local.hour >= SCHEDULE_HOUR

    def _build_message(self) -> str:
        sections: list[str] = []
        for label, args in COMMANDS:
            result = self.command(args)
            output = result.stdout.strip()
            if result.returncode != 0:
                raise AutomationFailure(f"{label} failed (exit {result.returncode})")
            if not output:
                raise AutomationFailure(f"{label} produced no output")
            sections.append(f"$ {label}\n{output}")
        return "\n\n".join(sections)

    def _send_telegram(self, text: str) -> None:
        token = os.environ.get("TELEGRAM_BOT_TOKEN")
        chat_id = os.environ.get("TELEGRAM_HOME_CHANNEL")
        if not token or not chat_id:
            raise AutomationFailure("validated Telegram notifier configuration unavailable")
        data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
        request = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data, method="POST")
        last_error: Exception | None = None
        for _attempt in range(2):
            try:
                with urllib.request.urlopen(request, timeout=15) as response:
                    if response.status < 300:
                        return
                last_error = RuntimeError("Telegram returned non-success")
            except Exception as error:
                last_error = error
        raise AutomationFailure("Telegram delivery failed after one retry") from last_error

    def run_once(self, *, reason: str) -> None:
        now = self.now()
        state = self._state()
        state.update({"last_attempt_at": now.isoformat(), "last_attempt_reason": reason})
        if reason == "scheduled":
            state["last_scheduled_attempt_local_date"] = self._local_date(now)
        self._save_state(state)
        try:
            message = self._build_message()
            self.notifier(message)
            state = self._state()
            state.update({"last_successful_delivery_at": self.now().isoformat(), "last_delivery_local_date": self._local_date(self.now()), "last_delivery_reason": reason})
            self._save_state(state)
            print(json.dumps({"event": "hersocial_marketing_automation_delivered", "reason": reason}), flush=True)
        except AutomationFailure as error:
            failure = f"hersocial marketing automation FAILED to run: {str(error).splitlines()[0]}"
            try:
                self.notifier(failure)
                print(json.dumps({"event": "hersocial_marketing_automation_failure_delivered", "reason": reason}), flush=True)
            except AutomationFailure:
                print(json.dumps({"event": "hersocial_marketing_automation_transport_failed", "reason": reason}), flush=True)

    def run_scheduled_if_due(self) -> bool:
        now = self.now()
        state = self._state()
        if not self._is_due(now) or state.get("last_scheduled_attempt_local_date") == self._local_date(now):
            return False
        self.run_once(reason="scheduled")
        return True

    def run_forever(self, poll_seconds: int) -> None:
        while True:
            self.run_scheduled_if_due()
            time.sleep(max(1, poll_seconds))

def main() -> int:
    parser = argparse.ArgumentParser(description="Run HerSocial read-only weekly marketing automation.")
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--poll-seconds", type=int, default=30)
    parser.add_argument("--run-once", action="store_true")
    args = parser.parse_args()
    runner = MarketingAutomationRunner(state_path=args.state_path)
    if args.run_once:
        runner.run_once(reason="manual")
    else:
        runner.run_forever(args.poll_seconds)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
