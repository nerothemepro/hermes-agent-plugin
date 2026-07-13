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
        self.seen_path = self.state_dir / "run-statuses.json"
        self.bootstrap_path = self.state_dir / "bootstrap-complete"
        self.zombie_baseline_path = self.state_dir / "zombie-baseline.json"
        self.project_path = Path(os.environ.get("SDTK_PROJECT_PATH", "/workspace/hermes-agent-plugin"))
        self.interval = max(1, int(os.environ.get("HERMES_MONITOR_INTERVAL_SECONDS", "10")))
        self.deadline_ratio = float(os.environ.get("HERMES_MONITOR_DEADLINE_RATIO", "0.75"))
        self.token_env = os.environ.get("HERMES_CONTROL_PLANE_BOT_TOKEN_ENV", "TELEGRAM_BOT_TOKEN")
        self.chat_env = os.environ.get("HERMES_CONTROL_PLANE_NOTIFY_CHAT_ENV", "TELEGRAM_HOME_CHANNEL")
        self.dedupe = self._load_json(self.dedupe_path, {})
        self.seen = self._load_json(self.seen_path, {})
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.state_dir, 0o700)
        if not self.zombie_baseline_path.exists():
            self._save_json(self.zombie_baseline_path, {"count": self._zombie_count(), "captured_at": utc_now()})

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

    def _hermes_task_status(self, task_id: str) -> str | None:
        result = subprocess.run(
            ["/workspace/.venvs/hermes-agent/bin/hermes", "kanban", "show", task_id, "--json"],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
            env={k: v for k, v in os.environ.items() if k != "HERMES_KANBAN_HOME"},
        )
        if result.returncode != 0:
            return None
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            return None
        task = payload.get("task", payload)
        return task.get("status") if isinstance(task, dict) else None

    def _zombie_count(self) -> int:
        result = subprocess.run(["ps", "-eo", "stat,args"], check=False, capture_output=True, text=True, timeout=10)
        return sum(1 for line in result.stdout.splitlines() if "[hermes] <defunct>" in line)

    def _dispatcher_healthy(self) -> bool:
        result = subprocess.run(
            ["bash", "/workspace/hermes-agent-plugin/scripts/herprofile_status.sh", "herorches"],
            check=False, capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0 and "Gateway is running" in result.stdout

    def _infrastructure_checks(self) -> dict:
        baseline = self._load_json(self.zombie_baseline_path, {"count": 0})
        zombies = self._zombie_count()
        dispatcher_ok = self._dispatcher_healthy()
        if not dispatcher_ok:
            self._notify("dispatcher_down", "Hermes dispatcher gateway is unavailable\nprofile: herorches\nrecovery: inspect gateway log, then use the approved gateway restart runbook.")
        if zombies > int(baseline.get("count", 0)):
            self._notify("zombie_baseline_exceeded", f"Hermes zombie count increased\nbaseline: {baseline.get('count', 0)}\ncurrent: {zombies}\nrecovery: stop dispatch and inspect supervisor/gateway logs.")
        return {"dispatcher_healthy": dispatcher_ok, "zombie_count": zombies, "zombie_baseline": baseline.get("count", 0)}

    @staticmethod
    def _deadline_risk(task: dict, ratio: float) -> bool:
        submitted = task.get("submitted_at")
        deadline = task.get("deadline_at")
        if not submitted or not deadline:
            return False
        try:
            start = datetime.fromisoformat(submitted.replace("Z", "+00:00"))
            end = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
        except ValueError:
            return False
        total = (end - start).total_seconds()
        return total > 0 and (datetime.now(timezone.utc) - start).total_seconds() >= total * ratio

    def _registry_records(self) -> list[dict]:
        records = []
        for path in sorted(self.registry.glob("*.json")):
            record = self._load_json(path, None)
            if isinstance(record, dict) and record.get("run_id") and record.get("state_path"):
                records.append(record)
        return records

    def _is_new_status(self, run_id: str, status: str | None) -> bool:
        previous = self.seen.get(run_id)
        self.seen[run_id] = status
        self._save_json(self.seen_path, self.seen)
        return previous != status

    def _state(self, record: dict) -> dict:
        return self._load_json(Path(record["state_path"]), {})

    def tick(self) -> list[dict]:
        observations = [{"infrastructure": self._infrastructure_checks()}]
        bootstrap = not self.bootstrap_path.exists()
        for record in self._registry_records():
            run_id = record["run_id"]
            state = self._state(record)
            run_status = state.get("status") or state.get("run_status")
            waiting_task_id = state.get("waiting_task_id")
            tasks = state.get("tasks", {})
            waiting_task = tasks.get(waiting_task_id, {}) if waiting_task_id else {}
            if run_status == "running" and not waiting_task:
                active = [(task_id, task) for task_id, task in tasks.items() if task.get("status") == "running_external"]
                if len(active) == 1:
                    waiting_task_id, waiting_task = active[0]
            status = waiting_task.get("status") if run_status == "running" and waiting_task else run_status
            status_changed = self._is_new_status(run_id, status)
            observation = {"run_id": run_id, "status": status, "action": "none"}
            if bootstrap:
                observation["action"] = "baseline_only"
            elif status == "running_external":
                task = waiting_task
                task_id = task.get("external_ids", {}).get("hermes_task_id")
                external_status = self._hermes_task_status(task_id) if task_id else None
                observation["external_status"] = external_status
                if self._deadline_risk(task, self.deadline_ratio):
                    self._notify(f"{run_id}:deadline_risk", f"SDTK external deadline risk\nrun_id: {run_id}\ntask_id: {task_id or waiting_task_id}\nrecovery: inspect worker progress; do not retry automatically.")
                if external_status in (None, "ready"):
                    self._notify(f"{run_id}:external_unclaimed", f"SDTK external task is not actively claimed\nrun_id: {run_id}\ntask_id: {task_id or waiting_task_id}\nrecovery: inspect dispatcher and board queue; do not create a duplicate task.")
                if external_status in ("done", "blocked", "failed"):
                    continued = self._run(["sdtk-agent", "run", "continue"], run_id)
                    observation["action"] = "continue"
                    observation["continue_status"] = continued.get("status")
            elif status == "waiting_for_approval" and status_changed:
                gate = state.get("waiting_gate") or state.get("gate") or "owner_review"
                self._notify(
                    f"{run_id}:waiting_for_approval:{gate}",
                    f"SDTK run waiting for approval\nrun_id: {run_id}\ngate: {gate}\nAPPROVE GATE {run_id} {gate}",
                )
            elif status == "completed" and status_changed:
                self._notify(
                    f"{run_id}:completed",
                    f"SDTK run completed\nrun_id: {run_id}\nreport: {record.get('canonical_report_path', '')}",
                )
            elif status in ("failed", "blocked", "cancelled") and status_changed:
                self._notify(f"{run_id}:failure:{status}", f"SDTK run requires attention\nrun_id: {run_id}\nstatus: {status}")
            observations.append(observation)
        if bootstrap:
            self.bootstrap_path.write_text(utc_now() + "\n", encoding="utf-8")
            os.chmod(self.bootstrap_path, 0o600)
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
