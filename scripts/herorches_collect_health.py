#!/usr/bin/env python3
"""Collect deterministic health data for the local Hermes bot fleet.

This script is designed to be called by:
- HerOrches through the Hermes terminal tool
- host-side watchdog scripts
- manual CLI checks inside hermes-sandbox

It intentionally returns structured JSON so a monitoring bot can reason from
stable fields instead of trying to infer health from raw logs.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_PROFILE_BASE = Path('/opt/data/hermes-profiles')
BASE_PROFILES = ['hervid', 'herresearch', 'herdev', 'hertran', 'herwiki', 'hersocial']
OPTIONAL_PROFILES = ['herorches']
LMSTUDIO_URL = 'http://host.docker.internal:1234/v1/models'
COMFYUI_URL = 'http://host.docker.internal:8188/system_stats'
WAN21_URL = 'http://host.docker.internal:8010/health'
LOG_SIGNAL_PATTERN = re.compile(
    r'(ERROR|Traceback|Context length exceeded|API call failed|OAuthException|timed out|Network is unreachable)',
    re.IGNORECASE,
)
PROFILE_DEPENDENCIES = {
    'hervid': ['lmstudio', 'comfyui', 'wan21'],
    'herresearch': ['lmstudio'],
    'herdev': ['lmstudio'],
    'hertran': ['lmstudio'],
    'herwiki': ['lmstudio'],
    'hersocial': ['lmstudio'],
    'herorches': ['lmstudio'],
}
EXPECTED_MODELS = {
    'hervid': ['google/gemma-4-12b-qat'],
    'herresearch': ['google/gemma-4-26b-a4b-qat'],
    'herdev': ['qwen/qwen3.6-27b'],
    'hertran': ['google/gemma-4-26b-a4b-qat'],
    'herwiki': ['google/gemma-4-26b-a4b-qat'],
    'hersocial': ['google/gemma-4-26b-a4b-qat'],
    'herorches': ['google/gemma-4-26b-a4b-qat', 'qwen/qwen3.6-27b'],
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--profiles', default='', help='Space-separated profile list. Default: auto-detect known profiles.')
    parser.add_argument('--profile-base', default=str(DEFAULT_PROFILE_BASE))
    parser.add_argument('--log-lines', type=int, default=40)
    parser.add_argument('--json', action='store_true', help='Emit JSON only.')
    parser.add_argument('--incidents-only', action='store_true', help='Hide healthy profiles in human output.')
    parser.add_argument('--timeout-seconds', type=int, default=5)
    return parser.parse_args()


def autodetect_profiles(profile_base: Path) -> list[str]:
    profiles = list(BASE_PROFILES)
    for optional in OPTIONAL_PROFILES:
        if (profile_base / optional).is_dir():
            profiles.append(optional)
    return profiles


def run_command(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def http_json(url: str, timeout_seconds: int) -> tuple[bool, Any, str | None]:
    try:
        with urllib.request.urlopen(url, timeout=timeout_seconds) as response:
            return True, json.load(response), None
    except urllib.error.HTTPError as exc:
        return False, None, f'HTTP {exc.code}: {exc.reason}'
    except urllib.error.URLError as exc:
        return False, None, str(exc.reason)
    except Exception as exc:
        return False, None, str(exc)


def discover_gateway_processes() -> dict[str, dict[str, Any]]:
    result = run_command(['pgrep', '-af', 'hermes gateway run'])
    mapping: dict[str, dict[str, Any]] = {}
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        pid = parts[0]
        environ_path = Path('/proc') / pid / 'environ'
        if not environ_path.exists():
            continue
        try:
            raw = environ_path.read_bytes()
        except OSError:
            continue
        env = {}
        for pair in raw.split(b'\x00'):
            if b'=' not in pair:
                continue
            key, value = pair.split(b'=', 1)
            env[key.decode('utf-8', errors='ignore')] = value.decode('utf-8', errors='ignore')
        home = env.get('HERMES_HOME', '')
        if not home:
            continue
        mapping[home] = {
            'pid': int(pid),
            'cmd': parts[1] if len(parts) > 1 else '',
        }
    return mapping


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return None


def recent_log_signals(log_path: Path, max_lines: int) -> list[str]:
    if not log_path.exists():
        return []
    try:
        lines = log_path.read_text(encoding='utf-8', errors='ignore').splitlines()[-max_lines:]
    except Exception:
        return []
    return [line.strip() for line in lines if LOG_SIGNAL_PATTERN.search(line)]


def evaluate_profile(profile: str, profile_base: Path, process_map: dict[str, dict[str, Any]], dependency_states: dict[str, dict[str, Any]], log_lines: int) -> dict[str, Any]:
    home = profile_base / profile
    state_path = home / 'gateway_state.json'
    log_path = home / 'logs' / 'gateway.log'
    issues: list[str] = []
    process = process_map.get(str(home))
    state = read_json(state_path) or {}
    recent_signals = recent_log_signals(log_path, log_lines)
    platform = (state.get('platforms') or {}).get('telegram') or {}
    platform_state = platform.get('state')
    gateway_state = state.get('gateway_state')

    if not home.is_dir():
        status = 'missing'
        issues.append('profile_dir_missing')
    elif process is None:
        if gateway_state == 'running':
            status = 'stale'
            issues.append('stale_gateway_state')
        else:
            status = 'down'
            issues.append('gateway_not_running')
    elif gateway_state != 'running':
        status = 'degraded'
        issues.append(f"gateway_state={gateway_state or 'unknown'}")
    elif platform_state and platform_state != 'connected':
        status = 'degraded'
        issues.append(f'telegram={platform_state}')
    else:
        status = 'healthy'

    dependency_failures = []
    for dep in PROFILE_DEPENDENCIES.get(profile, []):
        dep_state = dependency_states.get(dep, {})
        if not dep_state.get('reachable', False):
            dependency_failures.append(dep)
            issues.append(f'{dep}_unreachable')
    if status == 'healthy' and dependency_failures:
        status = 'degraded'

    return {
        'name': profile,
        'status': status,
        'home': str(home),
        'gateway_state_file': state_path.exists(),
        'gateway_state': gateway_state,
        'pid': process['pid'] if process else None,
        'pid_alive': process is not None,
        'platform_state': platform_state,
        'active_agents': state.get('active_agents'),
        'restart_requested': state.get('restart_requested'),
        'exit_reason': state.get('exit_reason'),
        'updated_at': state.get('updated_at'),
        'issues': issues,
        'dependency_failures': dependency_failures,
        'log_path': str(log_path),
        'recent_signals': recent_signals[-5:],
        'expected_models': EXPECTED_MODELS.get(profile, []),
    }


def collect_dependency_states(timeout_seconds: int) -> dict[str, dict[str, Any]]:
    lm_ok, lm_payload, lm_error = http_json(LMSTUDIO_URL, timeout_seconds)
    models = []
    if lm_ok and isinstance(lm_payload, dict):
        data = lm_payload.get('data') or []
        for item in data:
            if isinstance(item, dict) and item.get('id'):
                models.append(item['id'])

    comfy_ok, comfy_payload, comfy_error = http_json(COMFYUI_URL, timeout_seconds)
    wan_ok, wan_payload, wan_error = http_json(WAN21_URL, timeout_seconds)

    return {
        'lmstudio': {
            'reachable': lm_ok,
            'url': LMSTUDIO_URL,
            'error': lm_error,
            'models': models,
            'model_count': len(models),
        },
        'comfyui': {
            'reachable': comfy_ok,
            'url': COMFYUI_URL,
            'error': comfy_error,
            'device_name': ((comfy_payload or {}).get('devices') or [{}])[0].get('name') if isinstance(comfy_payload, dict) else None,
        },
        'wan21': {
            'reachable': wan_ok,
            'url': WAN21_URL,
            'error': wan_error,
            'payload': wan_payload if wan_ok else None,
        },
    }


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    profile_base = Path(args.profile_base)
    profiles = args.profiles.split() if args.profiles.strip() else autodetect_profiles(profile_base)
    process_map = discover_gateway_processes()
    dependency_states = collect_dependency_states(args.timeout_seconds)
    profile_rows = [
        evaluate_profile(profile, profile_base, process_map, dependency_states, args.log_lines)
        for profile in profiles
    ]
    status_counter = Counter(row['status'] for row in profile_rows)
    incidents = [row for row in profile_rows if row['status'] != 'healthy']
    recommendations: list[str] = []
    for row in incidents:
        if row['status'] in {'down', 'stale'}:
            recommendations.append(f"restart_profile:{row['name']}")
        elif row['status'] == 'degraded' and 'telegram=connected' not in row['issues']:
            recommendations.append(f"inspect_or_restart_profile:{row['name']}")
    for dep_name, dep_state in dependency_states.items():
        if not dep_state.get('reachable', False):
            recommendations.append(f'restore_dependency:{dep_name}')
    return {
        'generated_at': utc_now(),
        'profile_base': str(profile_base),
        'profiles': profile_rows,
        'dependencies': dependency_states,
        'summary': {
            'total_profiles': len(profile_rows),
            'healthy': status_counter.get('healthy', 0),
            'degraded': status_counter.get('degraded', 0),
            'down': status_counter.get('down', 0),
            'stale': status_counter.get('stale', 0),
            'missing': status_counter.get('missing', 0),
            'incident_count': len(incidents),
        },
        'recommendations': recommendations,
    }


def print_human(report: dict[str, Any], incidents_only: bool) -> None:
    summary = report['summary']
    print(
        f"[health] profiles={summary['total_profiles']} healthy={summary['healthy']} degraded={summary['degraded']} down={summary['down']} stale={summary['stale']} missing={summary['missing']}"
    )
    for dep_name, dep_state in report['dependencies'].items():
        state = 'ok' if dep_state.get('reachable') else 'fail'
        extra = ''
        if dep_name == 'lmstudio' and dep_state.get('reachable'):
            extra = f" models={dep_state.get('model_count', 0)}"
        if dep_state.get('error'):
            extra = f" error={dep_state['error']}"
        print(f'[dep] {dep_name}={state}{extra}')
    for row in report['profiles']:
        if incidents_only and row['status'] == 'healthy':
            continue
        print(
            f"[profile] {row['name']} status={row['status']} pid={row['pid'] or '-'} gateway={row['gateway_state'] or '-'} telegram={row['platform_state'] or '-'}"
        )
        for issue in row['issues']:
            print(f'  issue: {issue}')
        for signal in row['recent_signals']:
            print(f'  log: {signal}')
    if report['recommendations']:
        print('[next]')
        for rec in report['recommendations']:
            print(f'  - {rec}')


def main() -> int:
    args = parse_args()
    report = build_report(args)
    if args.json:
        json.dump(report, sys.stdout, indent=2, ensure_ascii=False)
        print()
    else:
        print_human(report, args.incidents_only)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
