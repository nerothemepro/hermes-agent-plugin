#!/bin/sh
set -eu

MODE="${1:-install}"
ROOT="${COMFYUI_MODELS_ROOT:-/opt/ComfyUI/models}"
MIN_FREE_KB=104857600

case "$MODE" in
  install|--check) ;;
  *)
    echo "Usage: $0 [--check]"
    exit 2
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "STOP: required command is missing: $1"
    exit 21
  fi
}

verify_file() {
  verify_target="$1"
  verify_expected_size="$2"
  verify_expected_sha="$3"

  if [ ! -f "$verify_target" ]; then
    echo "MISSING: $verify_target"
    return 1
  fi

  verify_actual_size=$(stat -c '%s' "$verify_target")
  if [ "$verify_actual_size" != "$verify_expected_size" ]; then
    echo "STOP: size mismatch for $verify_target"
    echo "expected_size=$verify_expected_size actual_size=$verify_actual_size"
    exit 23
  fi

  verify_actual_sha=$(sha256sum "$verify_target" | awk '{print $1}')
  if [ "$verify_actual_sha" != "$verify_expected_sha" ]; then
    echo "STOP: SHA256 mismatch for $verify_target"
    exit 24
  fi

  echo "VERIFIED: $verify_target"
}

fetch_file() {
  fetch_url="$1"
  fetch_target="$2"
  fetch_expected_size="$3"
  fetch_expected_sha="$4"
  fetch_part="${fetch_target}.part"

  mkdir -p "$(dirname "$fetch_target")"

  if [ -f "$fetch_target" ]; then
    verify_file "$fetch_target" "$fetch_expected_size" "$fetch_expected_sha"
    return
  fi

  if [ -f "$fetch_part" ]; then
    fetch_part_size=$(stat -c '%s' "$fetch_part")
    if [ "$fetch_part_size" -eq "$fetch_expected_size" ]; then
      verify_file "$fetch_part" "$fetch_expected_size" "$fetch_expected_sha"
      mv "$fetch_part" "$fetch_target"
      echo "INSTALLED FROM COMPLETED PART: $fetch_target"
      return
    fi
    if [ "$fetch_part_size" -gt "$fetch_expected_size" ]; then
      echo "STOP: partial file exceeds expected size: $fetch_part"
      exit 23
    fi
    echo "RESUMING: $fetch_part ($fetch_part_size/$fetch_expected_size bytes)"
  else
    echo "DOWNLOADING: $fetch_target"
  fi

  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 5 --retry-delay 5 -C - -o "$fetch_part" "$fetch_url"
  elif command -v wget >/dev/null 2>&1; then
    wget -c -O "$fetch_part" "$fetch_url"
  else
    echo "STOP: curl or wget is required"
    exit 21
  fi

  verify_file "$fetch_part" "$fetch_expected_size" "$fetch_expected_sha"
  mv "$fetch_part" "$fetch_target"
  echo "INSTALLED: $fetch_target"
}

echo "=== Commercial image stack preflight ==="
if [ ! -d "$ROOT" ]; then
  echo "STOP: ComfyUI models directory does not exist: $ROOT"
  exit 20
fi

require_command awk
require_command df
require_command sha256sum
require_command stat

df -h "$ROOT"
free_kb=$(df -Pk "$ROOT" | awk 'NR == 2 {print $4}')
echo "FREE_KB=$free_kb"
if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
  echo "STOP: less than 100 GiB free in the ComfyUI models volume"
  exit 20
fi

echo "=== Partial downloads ==="
find "$ROOT" -type f -name '*.part' -ls

flux="$ROOT/checkpoints/flux1-schnell-fp8.safetensors"
echo "=== Verify existing FLUX.1-schnell fp8 ==="
verify_file \
  "$flux" \
  17236328572 \
  ead426278b49030e9da5df862994f25ce94ab2ee4df38b556ddddb3db093bf72

if [ "$MODE" = "--check" ]; then
  echo "PREFLIGHT_OK"
  exit 0
fi

fetch_file \
  "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/462165984030d82259a11f4367a4eed129e94a7b/sd_xl_base_1.0.safetensors?download=true" \
  "$ROOT/checkpoints/sd_xl_base_1.0.safetensors" \
  6938078334 \
  31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b

fetch_file \
  "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/ac93e0dda1f6d448cae19bbfab8c5e720a5e48bc/RealVisXL_V5.0_fp16.safetensors?download=true" \
  "$ROOT/checkpoints/RealVisXL_V5.0_fp16.safetensors" \
  6938065488 \
  6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80

fetch_file \
  "https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/801a4a3fa3d4c936f4feea95b98607bc6726f80c/diffusion_pytorch_model_promax.safetensors?download=true" \
  "$ROOT/controlnet/controlnet-union-sdxl-1.0-promax.safetensors" \
  2513342408 \
  9fae2e50cb431bfcbe05822b59ec2228df545ef27f711dea8949e9f4ed9f7cdc

fetch_file \
  "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
  "$ROOT/upscale_models/RealESRGAN_x4plus.pth" \
  67040989 \
  4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1

fetch_file \
  "https://huggingface.co/Comfy-Org/BiRefNet/resolve/8fdc9d315889de96cc0c6269eeecd333e2727889/background_removal/birefnet.safetensors?download=true" \
  "$ROOT/background_removal/birefnet.safetensors" \
  444473596 \
  9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154

license_dir="$ROOT/_licenses/commercial-image-stack"
mkdir -p "$license_dir"
printf '%s\n' \
  "flux1-schnell-fp8.safetensors | Apache-2.0 | Comfy-Org/flux1-schnell" \
  "sd_xl_base_1.0.safetensors | CreativeML OpenRAIL++-M | stabilityai/stable-diffusion-xl-base-1.0" \
  "RealVisXL_V5.0_fp16.safetensors | OpenRAIL++ | SG161222/RealVisXL_V5.0" \
  "controlnet-union-sdxl-1.0-promax.safetensors | Apache-2.0 | xinsir/controlnet-union-sdxl-1.0" \
  "RealESRGAN_x4plus.pth | BSD-3-Clause | xinntao/Real-ESRGAN v0.1.0" \
  "birefnet.safetensors | MIT | Comfy-Org/BiRefNet" \
  "EXCLUDED: FLUX.1-dev, flux1-redux-dev, Juggernaut XL without commercial grant, 4x-UltraSharp" \
  >"$license_dir/manifest.txt"

echo "=== Installed image stack ==="
du -h \
  "$ROOT/checkpoints/flux1-schnell-fp8.safetensors" \
  "$ROOT/checkpoints/sd_xl_base_1.0.safetensors" \
  "$ROOT/checkpoints/RealVisXL_V5.0_fp16.safetensors" \
  "$ROOT/controlnet/controlnet-union-sdxl-1.0-promax.safetensors" \
  "$ROOT/upscale_models/RealESRGAN_x4plus.pth" \
  "$ROOT/background_removal/birefnet.safetensors"

echo "=== Remaining disk ==="
df -h "$ROOT"
echo "INSTALL_OK"
