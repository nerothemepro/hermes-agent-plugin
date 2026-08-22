# Local HyperFrames Provider Adapter

This operator-owned adapter provides the local-only delegates expected by sdtk-marketing-kit. It never uses a tunnel, cloud render, remote asset import, social publish, or credentials.

## Runtime Setup

Keep these values in the operator's 0600 runtime environment. Do not place values in project records, templates, or chat logs.

~~~bash
export SDTK_MARKETING_VIDEO_PROVIDER_HYPERFRAMES_DOCTOR_CMD='node /workspace/hermes-agent-plugin/scripts/marketing/hyperframes-provider.js doctor'
export SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_PREVIEW='node /workspace/hermes-agent-plugin/scripts/marketing/hyperframes-provider.js preview --project {project} --mode {mode} --port {port}'
export SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_PREVIEW_STOP='node /workspace/hermes-agent-plugin/scripts/marketing/hyperframes-provider.js stop --project {project} --session-id {session_id} --pid {pid} --ownership-token {ownership_token}'
export SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_SNAPSHOT='node /workspace/hermes-agent-plugin/scripts/marketing/hyperframes-provider.js snapshot --project {project} --scene {scene} --phase {phase} --source-sha256 {source_sha256}'
export SDTK_MARKETING_VIDEO_CMD_HYPERFRAMES_CHECK='node /workspace/hermes-agent-plugin/scripts/marketing/hyperframes-provider.js check --project {project} --source-sha256 {source_sha256} --snapshots {snapshots}'
~~~

The ledger project must contain provider/hyperframes/index.html. Install the exact approved HyperFrames CLI globally before use (for example `npm install -g hyperframes@0.8.8`); the adapter invokes the `hyperframes` binary directly from the restricted PATH and never installs or upgrades it at runtime.

## Preflight

The doctor reports node, chrome, ffmpeg, and shm. All four must be true. HyperFrames needs at least 256 MB in /dev/shm; create a Docker container with --shm-size=512m or the equivalent Compose setting before preview/render.

## Scene-Bound Snapshots

Before requesting snapshots, the composition owner writes provider/hyperframes/snapshot-times.json:

~~~json
{
  "schema_version": "sdtk.hyperframes-snapshot-times.v1",
  "source_sha256": "<recorded motion-map sha256>",
  "scenes": [{ "scene_id": "SC01", "times": { "entry": 0.0, "representative": 2.4, "final": 5.8 } }]
}
~~~

The adapter captures the exact requested timestamp, writes production/evidence/snapshots/<scene>/<phase>.png, and returns its SHA-256. Missing or SHA-mismatched mappings fail closed; an arbitrary global frame is never labelled as scene evidence.

## Preview Ownership

Preview is local at 127.0.0.1, uses HyperFrames preview --background, verifies local HTTP availability, and stores an ownership token outside composition source. Stop requires the exact session ID, PID, and ownership token. The wrapper never calls --kill-all.

## Check Mapping

The adapter runs hyperframes check --json --snapshots --frame-check. Any provider error becomes a blocking structured finding. Unknown errors remain blocking rather than being dropped.

## LM Studio Scene Executor

The same runtime env may configure the bounded local executor:

~~~bash
export SDTK_MARKETING_VIDEO_AGENT_LMSTUDIO_DOCTOR_CMD='python3 /workspace/hermes-agent-plugin/scripts/marketing/lmstudio-scene-executor.py --doctor'
export SDTK_MARKETING_VIDEO_AGENT_LMSTUDIO_EXECUTE_CMD='python3 /workspace/hermes-agent-plugin/scripts/marketing/lmstudio-scene-executor.py --task {task} --model {model}'
export SDTK_MARKETING_VIDEO_LOCAL_MODELS='qwen-local,gemma-local'
export SDTK_MARKETING_VIDEO_LMSTUDIO_STRUCTURED_MODELS='qwen-local,gemma-local'
~~~

The doctor performs only GET /v1/models. A model appears as structured-output capable only when it is both allowlisted and explicitly configured in SDTK_MARKETING_VIDEO_LMSTUDIO_STRUCTURED_MODELS. This is an operator assertion; the first owner-approved scene task remains the actual conformance proof. The executor accepts one SHA-approved task, issues one request with JSON Schema, returns at most one advisory provider fragment, rejects URLs, shell/process source, unsafe paths, unknown media, claims/CTA changes, and never applies, renders, or publishes the fragment.

### LM Studio Grammar Compatibility

Some LM Studio model backends reject nested JSON-Schema grammars and place a successful
schema-constrained reply in `reasoning_content` rather than `content`. The bounded executor
therefore asks the model for a flat proposal containing only `motion_id`, `source_fragment`, and
`approved_media_ids_csv`. It then constructs the canonical result itself, binding the exact task SHA,
scene ID, operation, model ID, and validated allowlisted media IDs. This is not a relaxed result contract:
any unknown field, unsafe source, duplicate media ID, unapproved motion, or unapproved media ID is rejected
before a fragment can be recorded. The compatibility path must be proven by one local structured-output probe
for each explicitly allowlisted model before it is selected for an attended scene task.
