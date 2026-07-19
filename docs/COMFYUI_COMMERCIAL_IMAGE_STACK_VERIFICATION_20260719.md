# ComfyUI Commercial Image Stack Verification

Date: 2026-07-19

Verdict: `PASS_WITH_DOCUMENTED_DEVIATIONS`

## Scope

The existing ComfyUI, LTX 2.3, and Wan 2.1 installation was preserved. This change added and verified a commercial-safe image-generation stack for website hero backgrounds, textures, product-pack covers, thumbnails, controlled SDXL compositions, upscaling, and background removal.

Runtime under test:

- GPU: NVIDIA GeForce RTX 3090, 24 GB VRAM
- ComfyUI: 0.24.0
- PyTorch: 2.5.1+cu124
- ComfyUI launch mode: `--lowvram`
- Verification artifacts: `/opt/data/hermes/comfy-commercial-image-stack-verification`
- Machine-readable result: `/opt/data/hermes/comfy-commercial-image-stack-verification/verification-results.json`

## Installed Model Manifest

| Model file | Target directory | Exact bytes | SHA-256 | Source revision | License gate |
|---|---|---:|---|---|---|
| `flux1-schnell-fp8.safetensors` | `models/checkpoints/` | 17,236,328,572 | `ead426278b49030e9da5df862994f25ce94ab2ee4df38b556ddddb3db093bf72` | `Comfy-Org/flux1-schnell` | Apache-2.0; approved |
| `sd_xl_base_1.0.safetensors` | `models/checkpoints/` | 6,938,078,334 | `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b` | `stabilityai/stable-diffusion-xl-base-1.0@462165984030d82259a11f4367a4eed129e94a7b` | CreativeML OpenRAIL++-M; approved subject to use restrictions |
| `RealVisXL_V5.0_fp16.safetensors` | `models/checkpoints/` | 6,938,065,488 | `6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80` | `SG161222/RealVisXL_V5.0@ac93e0dda1f6d448cae19bbfab8c5e720a5e48bc` | OpenRAIL++; approved subject to use restrictions |
| `controlnet-union-sdxl-1.0-promax.safetensors` | `models/controlnet/` | 2,513,342,408 | `9fae2e50cb431bfcbe05822b59ec2228df545ef27f711dea8949e9f4ed9f7cdc` | `xinsir/controlnet-union-sdxl-1.0@801a4a3fa3d4c936f4feea95b98607bc6726f80c` | Apache-2.0; approved |
| `RealESRGAN_x4plus.pth` | `models/upscale_models/` | 67,040,989 | `4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1` | `xinntao/Real-ESRGAN` release `v0.1.0` | BSD-3-Clause; approved |
| `birefnet.safetensors` | `models/background_removal/` | 444,473,596 | `9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154` | `Comfy-Org/BiRefNet@8fdc9d315889de96cc0c6269eeecd333e2727889` | MIT; approved |

The six-file stack occupies 34,137,329,387 bytes (34.137 GB / 31.793 GiB), including the pre-existing FLUX checkpoint. Newly added model files occupy 16,901,000,815 bytes (16.901 GB / 15.740 GiB).

## Custom Node State

- `ComfyUI_UltimateSDUpscale` is installed and pinned at commit `a5547db9e1d07d3318bb21e9e9c474f4c1e9c8df`; the `UltimateSDUpscale` node is exposed after restart.
- BiRefNet uses ComfyUI's native `LoadBackgroundRemovalModel` and `RemoveBackground` nodes. No additional background-removal custom node was needed.
- `ComfyUI-Manager` was not installed because it is not required at runtime and its dependency installation would add avoidable regression risk to the existing LTX/Wan environment.

## Live Verification

Peak VRAM was sampled from ComfyUI `/system_stats` while each prompt was active.

| Check | Result | Runtime | Peak VRAM | Evidence |
|---|---|---:|---:|---|
| FLUX.1-schnell, 1216x832, 4 steps | PASS | 51.042 s | 16.390 GiB | `flux-schnell-1216x832.png`, SHA-256 `42f65e6c1a6e31d35e66b90c61d77ad5cac08e625c612f452820759f628a38ce` |
| RealVisXL (SDXL) + Union ControlNet Canny, 1024x704, 16 steps | PASS, no OOM | 35.748 s | 8.916 GiB | `sdxl-realvis-controlnet-canny-1024x704.png`, SHA-256 `29aca18af5c44394f7c41a6e2ec398ef59dd70b801de4eb353d645826e05e561` |
| RealESRGAN x4 inference, resized to exact 2x | PASS | 9.716 s | 4.435 GiB | 2432x1664 `flux-realesrgan-2x-2432x1664.png`, SHA-256 `0680f672a81d8691c442b6b9f3b4ac0397717e9bcfd572924f714edd07a96e83` |
| BiRefNet background removal | PASS | 30.211 s | 9.365 GiB | RGBA 768x768; alpha min/max 0/255; transparent ratio 0.085300; opaque ratio 0.911750; SHA-256 `dca0a8366a31008beb6b988a09075513f267523f7ba0587e15c667c7507e25a8` |
| LTX 2.3 minimal I2V regression | PASS | 349.844 s | Not sampled by legacy runner | H.264, 512x320, 9 frames, 8 fps, 1.125 s; SHA-256 `a805062bb0c6a2fb3dc0c63afa58f89f9fffe50f102452b50cc09d0c180427c1` |
| Wan 2.1 minimal I2V regression | PASS | Legacy runner does not emit runtime | Not sampled by legacy runner | H.264, 832x480, 5 frames, 8 fps, 0.625 s, 245,609 bytes; SHA-256 `83f66b2d5548807c8fb4fcad4bf55253193c93166283828d43a3e073a7af418d` |

Wan service health also returned `ok=true`, `cuda_available=true`, `model_dir_exists=true`, and `queue_size=0`.

## Disk Evidence

- Install preflight: 724 GB free in the ComfyUI model volume, above the required 100 GiB stop gate.
- Install completion: 243 GB used, 714 GB free, 26% utilization.
- Installer terminal marker: `INSTALL_OK`.

## Operational Recovery

The LTX runner intentionally unloads LM Studio models to protect the 24 GB GPU from OOM. After verification, the following operational models were reloaded through the LM Studio native model-management API:

| Model | Context length | Load status |
|---|---:|---|
| `google/gemma-4-26b-a4b-qat` | 65,536 | loaded |
| `google/gemma-4-12b-qat` | 16,384 | loaded |
| `qwen/qwen3.6-27b` | 32,768 | loaded |

ComfyUI finished with zero running and zero pending prompts.

## Approved Deviations

1. Juggernaut XL was not installed. Its current distribution points users to separate commercial licensing, so it does not satisfy the hard commercial-safe gate without an explicit grant. RealVisXL V5.0 is the photoreal SDXL replacement.
2. `4x-UltraSharp` was not installed because its weight provenance/license could not be established strongly enough for commercial client work. Official `RealESRGAN_x4plus.pth` is the BSD-3-Clause replacement.
3. The requested 2x upscale is implemented as RealESRGAN x4 inference followed by a Lanczos resize to exact 2x dimensions.
4. The 3-5 second FLUX target was not met. Actual wall time was 51.042 seconds with ComfyUI running in `--lowvram` mode. Output correctness passed; this is a documented performance deviation.
5. Existing `FLUX.1-dev` or `flux1-redux-dev` assets, if present for the established video pipeline, remain excluded from all commercial client-image workflows and were not modified.
6. The Docker `No such exec instance` message appeared only after the installer had printed `INSTALL_OK`; it was a Docker Desktop interactive-exec cleanup artifact, not an installation failure.

## Reproduction

```bash
python3 /workspace/hermes-agent-plugin/scripts/verify_comfyui_commercial_image_stack.py
```

The verifier checks required node exposure, queues bounded workflows, verifies output dimensions and alpha semantics, samples peak VRAM, and writes `verification-results.json`.
