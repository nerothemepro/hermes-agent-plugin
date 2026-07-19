#!/bin/sh
set -eu

CUSTOM_NODES_ROOT="${COMFYUI_CUSTOM_NODES_ROOT:-/opt/ComfyUI/custom_nodes}"
NODE_NAME=ComfyUI_UltimateSDUpscale
NODE_REPO=https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git
NODE_COMMIT=a5547db9e1d07d3318bb21e9e9c474f4c1e9c8df
NODE_PATH="$CUSTOM_NODES_ROOT/$NODE_NAME"
PART_PATH="${NODE_PATH}.part"

if [ ! -d "$CUSTOM_NODES_ROOT" ]; then
  echo "STOP: custom_nodes directory does not exist: $CUSTOM_NODES_ROOT"
  exit 20
fi

if ! command -v git >/dev/null 2>&1; then
  echo "STOP: git is not installed in the ComfyUI container"
  exit 21
fi

if [ -e "$NODE_PATH" ]; then
  current_commit=$(git -C "$NODE_PATH" rev-parse HEAD 2>/dev/null || true)
  if [ "$current_commit" != "$NODE_COMMIT" ]; then
    echo "STOP: $NODE_PATH exists at unexpected revision: ${current_commit:-unknown}"
    exit 22
  fi
  git -C "$NODE_PATH" submodule update --init --recursive
  echo "VERIFIED: $NODE_NAME@$current_commit"
  echo "NODE_INSTALL_OK"
  exit 0
fi

if [ -e "$PART_PATH" ]; then
  echo "STOP: incomplete node directory already exists: $PART_PATH"
  exit 23
fi

git clone --no-checkout "$NODE_REPO" "$PART_PATH"
git -C "$PART_PATH" checkout --detach "$NODE_COMMIT"
git -C "$PART_PATH" submodule update --init --recursive

current_commit=$(git -C "$PART_PATH" rev-parse HEAD)
if [ "$current_commit" != "$NODE_COMMIT" ]; then
  echo "STOP: checked-out node revision does not match the pinned commit"
  exit 24
fi

mv "$PART_PATH" "$NODE_PATH"
echo "INSTALLED: $NODE_NAME@$NODE_COMMIT"
echo "NODE_INSTALL_OK"
