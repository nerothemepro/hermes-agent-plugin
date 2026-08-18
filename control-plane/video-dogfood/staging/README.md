# Controller-led dogfood staging toolchain

This directory installs reviewed local `sdtk-agent-kit` and
`sdtk-agent-hermes-adapter` tarballs into immutable release directories.
The retained tarballs, installed package versions, and SHA-256 values are
verified before every activation.

## Install and verify

```bash
bash install-release.sh <release-id> <sdtk-agent-kit.tgz> <adapter.tgz>
bash verify-release.sh <release-id>
```

Installation writes through a private staging directory and atomically renames
it to `releases/<release-id>` only after package smoke checks pass. Failed
staging directories are preserved for diagnosis; scripts never delete them.

## Activate and roll back

```bash
bash activate-release.sh <release-id>
```

Activation first verifies the release, writes a mode-0600 record under
`activation-backups/`, then atomically switches the mode-0600
`active-release` pointer. Activating the prior verified release is rollback.
Historical releases and activation records are never deleted automatically.

The monitor resolves this pointer for each allowlisted SDTK command. Controller
commands should be invoked through:

```bash
bash with-active-toolchain.sh node ../controller.js inspect --run-id <run_id>
```

After activation, restart only `hermes-control-plane-monitor` if its process
must pick up non-toolchain environment changes, then verify its supervisor
status. The projector does not load these packages and does not require a
restart. HerOrches is not the primary controller in this dogfood mode.

No npm publication is required for dogfood fixes. Secrets, token values, and
runtime environment values must not be copied into release manifests or
activation records.
