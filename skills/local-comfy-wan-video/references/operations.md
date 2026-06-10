# Operations

## Restart Gateway

```bash
bash scripts/restart_hermes_gateway.sh
```

## Status

```bash
env HERMES_HOME=/opt/data/hermes LM_API_KEY=lm-studio /workspace/.venvs/hermes-agent/bin/hermes gateway status
```

## Logs

```bash
tail -160 /opt/data/hermes/logs/gateway.log
tail -160 /opt/data/hermes/logs/agent.log
```

## Latest Manifest

```bash
find /opt/data/hermes/media-sequences -maxdepth 2 -type f -name manifest.json -printf '%T@ %p
' | sort -nr | head -1
```

## Print Latest Video Path

```bash
python3 scripts/print_latest_manifest.py
```

## Approved Keyframe Reuse

If keyframes have already passed visual review, render video from them instead of regenerating keyframes:

```bash
EXISTING_KEYFRAME_DIR=/opt/data/hermes/media-sequences/<approved-run>/keyframes bash scripts/smoke_test_video.sh
```
