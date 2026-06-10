# Package Contents

## Source Code

```text
hermes-plugin/local_media/       Hermes plugin wrapper
media-pipeline/                  Python video generation pipeline
media-pipeline/workflows/        ComfyUI API workflows
```

## Operational Assets

```text
skills/local-comfy-wan-video/    Hermes skill and references
scripts/                         Install, verify, restart, smoke tests
docs/                            Setup/runbook/troubleshooting docs
```

## Excluded Assets

The `.gitignore` excludes model weights, generated media, logs, secrets, runtime sessions, and caches.

If a future change adds new generated paths, update `.gitignore` before committing.
