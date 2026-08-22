# Marketing Video Render Lease

`scripts/marketing/run-video-render-lease.sh` is the operator-side companion to
`sdtk-marketing video render lease request`. It is intentionally outside the npm package.

## Contract

```bash
bash scripts/marketing/run-video-render-lease.sh --lease <render-lease.json> [--dry-run]
```

The wrapper accepts only `sdtk.marketing-video-render-lease-request.v1` records in `REQUESTED`
state for the HyperFrames provider. It does not accept a render command from the request.

Operator configuration is runtime-only and must remain outside Git:

- `SDTK_MARKETING_RENDER_LEASE_VERIFY_EVIDENCE_CMD`
- `SDTK_MARKETING_RENDER_LEASE_UNLOAD_LLM_CMD`
- `SDTK_MARKETING_RENDER_LEASE_FREE_CACHE_CMD`
- `SDTK_MARKETING_RENDER_LEASE_RENDER_CMD`
- `SDTK_MARKETING_RENDER_LEASE_BANK_OUTPUT_CMD`

Each command may use `{lease}` and `{out}`. The wrapper runs them strictly in this order:

1. verify already-persisted local executor evidence;
2. unload the local LLM;
3. free renderer cache;
4. render exactly one approved output;
5. bank output and intermediate frames.

The machine-local implementation is `scripts/marketing/render-lease-local-operator.py`. It accepts only the canonical project lease, local credential-free LM Studio/ComfyUI endpoints, an MP4 under the configured review root, and a fixed HyperFrames argv. LM Studio unload follows the local REST `POST /api/v1/models/unload` contract and never records instance IDs.

Deploy the five runtime command bindings with:

```bash
bash scripts/deploy_marketing_render_lease_operator.sh
```

The deployment backs up `mkt-digest.env`, preserves mode `0600`, runs both operator test suites, and does not restart services or delete prior backups.

The JSON receipt contains only state, project ID, output reference, action names, and failed phase.
It never emits commands, credentials, endpoint values, process IDs, or model-instance IDs. The wrapper
does not publish, call cloud providers, reload a model, or create an accepted asset.
