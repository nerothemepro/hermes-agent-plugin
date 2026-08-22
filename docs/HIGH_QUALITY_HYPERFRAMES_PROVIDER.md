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

The ledger project must contain provider/hyperframes/index.html. The adapter uses npx --no-install hyperframes; it never installs or upgrades a package.

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
