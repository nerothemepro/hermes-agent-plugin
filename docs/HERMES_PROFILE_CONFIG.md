# Hermes Profile Config

Use a dedicated GenVideo profile instead of a general-purpose research agent. This keeps prompt/tool context small and response time predictable.

## Minimal Profile Shape

```yaml
model:
  default: google/gemma-4-12b-qat
  provider: lmstudio
  base_url: http://host.docker.internal:1234/v1
  context_length: 65536
  reasoning_effort: none

memory:
  memory_enabled: false
  user_profile_enabled: false
  memory_char_limit: 0
  user_char_limit: 0

plugins:
  enabled:
  - local_media

agent:
  max_turns: 8
  gateway_timeout: 3600

platform_toolsets:
  cli:
  - clarify
  - messaging
  - local_media
  telegram:
  - clarify
  - messaging
  - local_media

known_plugin_toolsets:
  cli:
  - local_media
  telegram:
  - local_media
```

## Model Choice

For this narrow GenVideo profile, prefer a fast model with reliable tool calling over a large general reasoning model. The source environment used:

```text
google/gemma-4-12b-qat
```

Use larger Qwen/Gemma models only for research/planning profiles, not for the video execution profile.

## Required Tool Behavior

Hermes should call `generate_video_sequence` for multi-shot video. It should not manually run arbitrary terminal commands for normal generation.

Hermes final responses must preserve exact paths returned by the tool:

```text
MEDIA:/opt/data/hermes/generated-videos/<exact-file-name>.mp4
```

Do not rewrite hyphens to underscores. Do not summarize or modify the MEDIA path.
