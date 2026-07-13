#!/usr/bin/env python3
"""Fail-closed, outbound-only monitor for prepared SDTK runs."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ALLOWED_ACTIONS = ("sdtk-agent", "run", "status"), ("sdtk-agent", "run", "continue")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Monitor:
    def __init__(self) -> None:
        self.hermes_home = Path(os.environ.get("HERMES_HOME", "/opt/data/hermes"))
        self.registry = self.hermes_home / "control-plane" / "runs"
        self.state_dir = self.hermes_home / "control-plane" / "monitor"
        self.dedupe_path = self.state_dir / "notifications.json"
        self.project_path = Path(os.environ.get("SDTK_PROJECT_PATH", "/workspace/hermes-agent-plugin"))
        self.interval = max(1, int(os.environ.get("HERMES_MONITOR_INTERVAL_SECONDS", "10")))
        self.deadline_ratio = float(os.environ.get("HERMES_MONITOR_DEADLINE_RATIO", "0.75"))
        self.token_env = os.environ.get("HERMES_CONTROL_PLANE_BOT_TOKEN_ENV", "TELEGRAM_BOT_TOKEN")
        self.chat_env = os.environ.get("HERMES_CONTROL_PLANE_NOTIFY_CHAT_ENV", "TELEGRAM_HOME_CHANNEL")
        self.dedupe = self._load_json(self.dedupe_path, {})
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.state_dir, 0o700)

    @staticmethod
    def _load_json(path: Path, fallback):
        try:
            with path.open(encoding="utf-8") as handle:
                value = json.load(handle)
            return value
        except (FileNotFoundError, json.JSONDecodeError):
            return fallback

    def _save_json(self, path: Path, value) -> None:
        temp = path.with_suffix(path.suffix + ".tmp")
        with temp.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.chmod(temp, 0o600)
        temp.replace(path)

    def _run(self, args: list[str], run_id: str) -> dict:
        if tuple(args) not in ALLOWED_ACTIONS:
            raise ValueError("monitor attempted a non-allowlisted SDTK command")
        result = subprocess.run(
            [*args, "--project-path", str(self.project_path), "--run-id", run_id, "--json"],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
            env={k: v for k, v in os.environ.items() if k != "HERMES_KANBAN_HOME"},
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            payload = {"status": "error", "exit_code": result.returncode, "stderr": result.stderr[-1000:]}
        payload["exit_code"] = result.returncode
        return payload

    def _notify(self, key: str, text: str) -> None:
        if self.dedupe.get(key) == hashlib.sha256(text.encode()).hexdigest():
            return
        token = os.environ.get(self.token_env)
        chat_id = os.environ.get(self.chat_env)
        if not token or not chat_id:
            print(json.dumps({"event": "notification_blocked", "key": key, "reason": "notification env missing"}))
            return
        data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=data, method="POST"
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status >= 300:
                raise RuntimeError(f"Telegram notification failed with HTTP {response.status}")
        self.dedupe[key] = hashlib.sha256(text.encode()).hexdigest()
        self._save_json(self.dedupe_path, self.dedupe)

    def _registry_records(self) -> list[dict]:
        records = []
        for path in sorted(self.registry.glob("*.json")):
            record = self._load_json(path, None)
            if isinstance(record, dict) and record.get("run_id") and record.get("state_path"):
                records.append(record)
        return records

    def _state(self, record: dict) -> dict:
        return self._load_json(Path(record["state_path"]), {})

    def tick(self) -> list[dict]:
        observations = []
        for record in self._registry_records():
            run_id = record["run_id"]
            state = self._state(record)
            status = state.get("status") or state.get("run_status")
            observation = {"run_id": run_id, "status": status, "action": "none"}
            if status == "running_external":
                result = self._run(["sdtk-agent", "run", "status"], run_id)
                observation["status_result"] = result.get("status")
                if result.get("status") in ("completed", "waiting_for_approval"):
                    continued = self._run(["sdtk-agent", "run", "continue"], run_id)
                    observation["action"] = "continue"
                    observation["continue_status"] = continued.get("status")
            elif status == "waiting_for_approval":
                gate = state.get("waiting_gate") or state.get("gate") or "owner_review"
                self._notify(
                    f"{run_id}:waiting_for_approval:{gate}",
                    f"SDTK run waiting for approval\nrun_id: {run_id}\ngate: {gate}\nAPPROVE GATE {run_id} {gate}",
                )
            elif status == "completed":
                self._notify(
                    f"{run_id}:completed",
                    f"SDTK run completed\nrun_id: {run_id}\nreport: {record.get('canonical_report_path', '')}",
                )
            elif status in ("failed", "blocked", "cancelled"):
                self._notify(f"{run_id}:failure:{status}", f"SDTK run requires attention\nrun_id: {run_id}\nstatus: {status}")
            observations.append(observation)
        return observations

    def run_forever(self) -> None:
        while True:
            try:
                for observation in self.tick():
                    print(json.dumps({"at": utc_now(), **observation}, sort_keys=True), flush=True)
            except Exception as error:  # fail closed; service supervisor restarts if needed
                print(json.dumps({"at": utc_now(), "event": "monitor_error", "error": str(error)}), flush=True)
            time.sleep(self.interval)


if __name__ == "__main__":
    Monitor().run_forever()
