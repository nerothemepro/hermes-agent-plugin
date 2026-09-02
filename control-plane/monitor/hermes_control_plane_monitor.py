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
        self.stale_seconds = max(60, int(os.environ.get("HERMES_MONITOR_STALE_SECONDS", "900")))
        self.toolchain_root = Path(os.environ.get("SDTK_VIDEO_DOGFOOD_TOOLCHAIN_ROOT", "/opt/data/hermes/control-plane/video-dogfood/toolchain"))
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

    def _sdtk_command(self, args: list[str]) -> list[str]:
        wrapper = self.project_path / "control-plane" / "video-dogfood" / "staging" / "with-active-toolchain.sh"
        if self._active_release() and wrapper.is_file():
            return [str(wrapper), *args]
        return args

    def _run(self, args: list[str], run_id: str) -> dict:
        if tuple(args) not in ALLOWED_ACTIONS:
            raise ValueError("monitor attempted a non-allowlisted SDTK command")
        result = subprocess.run(
            [*self._sdtk_command(args), "--project-path", str(self.project_path), "--run-id", run_id, "--json"],
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
        digest = hashlib.sha256(text.encode()).hexdigest()
        existing = self.dedupe.get(key)
        existing_digest = existing.get("hash") if isinstance(existing, dict) else existing
        if existing_digest == digest:
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
        sent_at = utc_now()
        self.dedupe[key] = {"hash": digest, "sent_at": sent_at}
        self._save_json(self.dedupe_path, self.dedupe)
        print(json.dumps({"event": "notification_sent", "key": key, "sent_at": sent_at}, sort_keys=True), flush=True)

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

    def _active_release(self) -> dict | None:
        pointer = self.toolchain_root / "active-release"
        try:
            release_id = pointer.read_text(encoding="utf-8").strip()
            if not release_id or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in release_id):
                return None
            manifest = self._load_json(self.toolchain_root / "releases" / release_id / "release.json", None)
            packages = manifest.get("packages", {}) if isinstance(manifest, dict) else {}
            return {
                "release_id": release_id,
                "sdtk_agent": packages.get("sdtk-agent-kit", {}).get("version"),
                "hermes_adapter": packages.get("sdtk-agent-hermes-adapter", {}).get("version"),
            }
        except OSError:
            return None

    def _task_stale(self, task: dict) -> bool:
        value = task.get("last_heartbeat") or task.get("updated_at") or task.get("submitted_at")
        if not value:
            return False
        try:
            observed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return False
        return (datetime.now(timezone.utc) - observed).total_seconds() >= self.stale_seconds

    def _infrastructure_checks(self) -> dict:
        baseline = self._load_json(self.zombie_baseline_path, {"count": 0})
        zombies = self._zombie_count()
        dispatcher_ok = self._dispatcher_healthy()
        if not dispatcher_ok:
            self._notify("dispatcher_down", "Hermes dispatcher gateway is unavailable\nprofile: herorches\nrecovery: inspect gateway log, then use the approved gateway restart runbook.")
        if zombies > int(baseline.get("count", 0)):
            self._notify("zombie_baseline_exceeded", f"Hermes zombie count increased\nbaseline: {baseline.get('count', 0)}\ncurrent: {zombies}\nrecovery: stop dispatch and inspect supervisor/gateway logs.")
        return {"dispatcher_healthy": dispatcher_ok, "zombie_count": zombies, "zombie_baseline": baseline.get("count", 0), "active_release": self._active_release()}

    @staticmethod
    def _deadline_risk(task: dict, ratio: float, interval: int) -> bool:
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
        elapsed = (datetime.now(timezone.utc) - start).total_seconds()
        return total > 0 and elapsed + interval >= total * ratio

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

    def _normalized_state(self, state_path: Path) -> dict:
        normalizer = Path(__file__).resolve().parents[1] / "video-self-service" / "normalized-state.js"
        result = subprocess.run(
            ["node", str(normalizer), str(state_path)], check=False, capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            raise RuntimeError("shared state normalization failed")
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("shared state normalization returned invalid JSON") from error

    def _state(self, record: dict) -> dict:
        return self._load_json(Path(record["state_path"]), {})

    def tick(self) -> list[dict]:
        observations = [{"infrastructure": self._infrastructure_checks()}]
        bootstrap = not self.bootstrap_path.exists()
        for record in self._registry_records():
            run_id = record["run_id"]
            state = self._state(record)
            normalized = self._normalized_state(Path(record["state_path"]))
            run_status = state.get("status") or state.get("run_status")
            tasks = state.get("tasks", {})
            waiting_task_id = state.get("waiting_task_id")
            waiting_task = tasks.get(waiting_task_id, {}) if waiting_task_id else {}
            active = [
                (task_id, task) for task_id, task in tasks.items()
                if task.get("status") == "running_external"
            ]
            if run_status == "running" and active:
                status = "running_external"
            elif run_status == "running" and waiting_task:
                status = waiting_task.get("status")
            else:
                status = run_status
            status_changed = self._is_new_status(run_id, status)
            observation = {
                "run_id": run_id,
                "normalized": normalized,
                "status": status,
                "action": "none",
                "active_task_ids": [task_id for task_id, _ in active],
            }
            if bootstrap:
                observation["action"] = "baseline_only"
            elif status == "running_external":
                terminal_external = False
                external_states = {}
                for task_id, task in active:
                    hermes_task_id = task.get("external_ids", {}).get("hermes_task_id")
                    external_status = self._hermes_task_status(hermes_task_id) if hermes_task_id else None
                    external_states[task_id] = external_status
                    if self._deadline_risk(task, self.deadline_ratio, self.interval):
                        self._notify(
                            f"{run_id}:{task_id}:deadline_risk",
                            f"SDTK external deadline risk\nrun_id: {run_id}\ntask_id: {task_id}\nworker: {task.get('role') or 'unknown'}\nrecovery: inspect worker progress; do not retry automatically.",
                        )
                    if self._task_stale(task):
                        heartbeat = task.get("last_heartbeat") or task.get("updated_at") or task.get("submitted_at") or "not recorded"
                        self._notify(
                            f"{run_id}:{task_id}:stale",
                            f"SDTK external task is stale\nrun_id: {run_id}\ntask_id: {task_id}\nworker: {task.get('role') or 'unknown'}\nlast heartbeat: {heartbeat}\nblocker_class: RECOVERABLE_RUNTIME\nnext action: inspect native card; do not create a duplicate.",
                        )
                    if external_status in (None, "ready"):
                        self._notify(
                            f"{run_id}:{task_id}:external_unclaimed",
                            f"SDTK external task is not actively claimed\nrun_id: {run_id}\ntask_id: {hermes_task_id or task_id}\nworker: {task.get('role') or 'unknown'}\nrecovery: inspect dispatcher and board queue; do not create a duplicate task.",
                        )
                    if external_status in ("done", "blocked", "failed"):
                        terminal_external = True
                observation["external_states"] = external_states
                if terminal_external:
                    continued = self._run(["sdtk-agent", "run", "continue"], run_id)
                    observation["action"] = "continue"
                    observation["continue_status"] = continued.get("status")
            elif normalized.get("blocker_class") == "OWNER_GATE" and status_changed:
                gate = normalized.get("owner_gate") or "owner_review"
                self._notify(
                    f"{run_id}:waiting_for_approval:{gate}",
                    f"SDTK run waiting for approval\nrun_id: {run_id}\ngate: {gate}\nAPPROVE GATE {run_id} {gate}",
                )
            elif normalized.get("status") == "completed" and status_changed:
                self._notify(
                    f"{run_id}:completed",
                    f"SDTK run completed\nrun_id: {run_id}\nreport: {record.get('canonical_report_path', '')}",
                )
            elif normalized.get("terminal") and normalized.get("status") in ("failed", "blocked", "cancelled") and status_changed:
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
