#!/usr/bin/env python3
"""Run bounded ComfyUI acceptance checks for the commercial image stack."""

from __future__ import annotations

import argparse
import json
import os
import struct
import time
import uuid
import zlib
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def request_json(
    base_url: str,
    path: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(base_url.rstrip("/") + path, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {path}: {detail}") from exc
    return json.loads(raw.decode("utf-8")) if raw else {}


def upload_image(base_url: str, source: Path, remote_name: str) -> str:
    boundary = "----sdtk-comfy-" + uuid.uuid4().hex
    data = source.read_bytes()
    chunks = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{remote_name}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n",
        data,
        b"\r\n",
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n',
        f"--{boundary}--\r\n".encode(),
    ]
    request = Request(
        base_url.rstrip("/") + "/upload/image",
        data=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        payload = json.load(response)
    return str(payload.get("name") or remote_name)


def vram_used(stats: dict[str, Any]) -> int:
    devices = stats.get("devices") or []
    if not devices:
        return 0
    device = devices[0]
    total = int(device.get("vram_total") or 0)
    free = int(device.get("vram_free") or 0)
    return max(0, total - free)


def find_image_ref(history: dict[str, Any]) -> dict[str, str]:
    for output in (history.get("outputs") or {}).values():
        for image in output.get("images") or []:
            if str(image.get("filename", "")).lower().endswith(".png"):
                return {
                    "filename": str(image["filename"]),
                    "subfolder": str(image.get("subfolder") or ""),
                    "type": str(image.get("type") or "output"),
                }
    raise RuntimeError("ComfyUI history contained no PNG output")


def download_image(base_url: str, ref: dict[str, str], target: Path) -> None:
    query = urlencode(ref)
    request = Request(base_url.rstrip("/") + "/view?" + query, headers={"Accept": "image/png"})
    with urlopen(request, timeout=180) as response:
        data = response.read()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def run_workflow(
    base_url: str,
    workflow: dict[str, Any],
    output_path: Path,
    timeout_seconds: int,
) -> dict[str, Any]:
    before = request_json(base_url, "/system_stats")
    peak = vram_used(before)
    started = time.monotonic()
    queued = request_json(
        base_url,
        "/prompt",
        method="POST",
        payload={"prompt": workflow, "client_id": "sdtk-commercial-stack-" + uuid.uuid4().hex},
    )
    prompt_id = str(queued.get("prompt_id") or "")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {queued}")

    history: dict[str, Any] | None = None
    while time.monotonic() - started < timeout_seconds:
        stats = request_json(base_url, "/system_stats")
        peak = max(peak, vram_used(stats))
        records = request_json(base_url, f"/history/{prompt_id}")
        if prompt_id in records:
            history = records[prompt_id]
            break
        time.sleep(0.35)
    if history is None:
        raise TimeoutError(f"ComfyUI prompt {prompt_id} exceeded {timeout_seconds}s")

    elapsed = round(time.monotonic() - started, 3)
    status = history.get("status") or {}
    if status.get("status_str") not in (None, "success") or status.get("completed") is False:
        messages = status.get("messages") or []
        raise RuntimeError(f"ComfyUI prompt {prompt_id} failed: {messages[-3:]}")
    ref = find_image_ref(history)
    download_image(base_url, ref, output_path)
    return {
        "prompt_id": prompt_id,
        "runtime_seconds": elapsed,
        "peak_vram_bytes": peak,
        "peak_vram_gib": round(peak / (1024 ** 3), 3),
        "output_path": str(output_path),
        "output_ref": ref,
    }


def free_models(base_url: str) -> None:
    request_json(base_url, "/free", method="POST", payload={"unload_models": True, "free_memory": True})
    time.sleep(2)


def flux_workflow(prefix: str, product: bool = False) -> dict[str, Any]:
    prompt = (
        "premium cobalt blue glass perfume bottle, centered product photography, clean white studio "
        "background, distinct silhouette, soft shadow, no text, no logo"
        if product
        else "abstract dark navy gradient hero background, soft blue glow detail, premium website design, "
        "subtle texture, clean negative space, no text, no logo"
    )
    width, height = ((768, 768) if product else (1216, 832))
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "flux1-schnell-fp8.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": prompt}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": "text, watermark, logo, blurry, low quality"}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0], "seed": 20260719 if not product else 20260720, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}},
    }


def controlnet_workflow(input_name: str, prefix: str) -> dict[str, Any]:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "2": {"class_type": "ImageScale", "inputs": {"image": ["1", 0], "upscale_method": "lanczos", "width": 1024, "height": 704, "crop": "disabled"}},
        "3": {"class_type": "Canny", "inputs": {"image": ["2", 0], "low_threshold": 0.25, "high_threshold": 0.75}},
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "RealVisXL_V5.0_fp16.safetensors"}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": "premium abstract navy and cobalt website hero background, soft luminous curves, subtle texture, elegant negative space, no text, no logo"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": "text, watermark, logo, noisy, low quality, artifacts"}},
        "7": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "controlnet-union-sdxl-1.0-promax.safetensors"}},
        "8": {"class_type": "SetUnionControlNetType", "inputs": {"control_net": ["7", 0], "type": "canny/lineart/anime_lineart/mlsd"}},
        "9": {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": ["5", 0], "negative": ["6", 0], "control_net": ["8", 0], "image": ["3", 0], "strength": 0.65, "start_percent": 0.0, "end_percent": 0.8, "vae": ["4", 2]}},
        "10": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 704, "batch_size": 1}},
        "11": {"class_type": "KSampler", "inputs": {"model": ["4", 0], "positive": ["9", 0], "negative": ["9", 1], "latent_image": ["10", 0], "seed": 20260721, "steps": 16, "cfg": 5.5, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0}},
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["4", 2]}},
        "13": {"class_type": "SaveImage", "inputs": {"images": ["12", 0], "filename_prefix": prefix}},
    }


def upscale_workflow(input_name: str, prefix: str) -> dict[str, Any]:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "RealESRGAN_x4plus.pth"}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "ImageScale", "inputs": {"image": ["3", 0], "upscale_method": "lanczos", "width": 2432, "height": 1664, "crop": "disabled"}},
        "5": {"class_type": "SaveImage", "inputs": {"images": ["4", 0], "filename_prefix": prefix}},
    }


def birefnet_workflow(input_name: str, prefix: str) -> dict[str, Any]:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "2": {"class_type": "LoadBackgroundRemovalModel", "inputs": {"bg_removal_name": "birefnet.safetensors"}},
        "3": {"class_type": "RemoveBackground", "inputs": {"image": ["1", 0], "bg_removal_model": ["2", 0]}},
        "4": {"class_type": "JoinImageWithAlpha", "inputs": {"image": ["1", 0], "alpha": ["3", 0]}},
        "5": {"class_type": "SaveImage", "inputs": {"images": ["4", 0], "filename_prefix": prefix}},
    }


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else (b if pb <= pc else c)


def inspect_png(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(f"not a PNG: {path}")
    position = 8
    width = height = bit_depth = color_type = interlace = None
    idat = bytearray()
    while position + 12 <= len(raw):
        length = struct.unpack(">I", raw[position:position + 4])[0]
        kind = raw[position + 4:position + 8]
        data = raw[position + 8:position + 8 + length]
        position += length + 12
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", data)
        elif kind == b"IDAT":
            idat.extend(data)
        elif kind == b"IEND":
            break
    if None in (width, height, bit_depth, color_type, interlace):
        raise RuntimeError(f"PNG missing IHDR: {path}")
    result: dict[str, Any] = {
        "width": width,
        "height": height,
        "bit_depth": bit_depth,
        "color_type": color_type,
        "file_bytes": path.stat().st_size,
    }
    if bit_depth != 8 or color_type not in (4, 6) or interlace != 0:
        result["alpha_present"] = color_type in (4, 6)
        return result

    channels = 2 if color_type == 4 else 4
    scanlines = zlib.decompress(bytes(idat))
    stride = width * channels
    previous = bytearray(stride)
    offset = 0
    alpha_values: list[int] = []
    for _ in range(height):
        filter_type = scanlines[offset]
        offset += 1
        row = bytearray(scanlines[offset:offset + stride])
        offset += stride
        for index in range(stride):
            left = row[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 1:
                row[index] = (row[index] + left) & 255
            elif filter_type == 2:
                row[index] = (row[index] + up) & 255
            elif filter_type == 3:
                row[index] = (row[index] + ((left + up) // 2)) & 255
            elif filter_type == 4:
                row[index] = (row[index] + paeth(left, up, upper_left)) & 255
            elif filter_type != 0:
                raise RuntimeError(f"unsupported PNG filter {filter_type}")
        alpha_values.extend(row[channels - 1::channels])
        previous = row
    transparent = sum(value < 16 for value in alpha_values)
    opaque = sum(value > 239 for value in alpha_values)
    total = len(alpha_values)
    result.update({
        "alpha_present": True,
        "alpha_min": min(alpha_values),
        "alpha_max": max(alpha_values),
        "transparent_ratio": round(transparent / total, 6),
        "opaque_ratio": round(opaque / total, 6),
        "alpha_useful": min(alpha_values) < 16 and max(alpha_values) > 239 and transparent > 0 and opaque > 0,
    })
    return result


def require_nodes(info: dict[str, Any]) -> None:
    required = {
        "Canny", "CheckpointLoaderSimple", "ControlNetApplyAdvanced", "ControlNetLoader",
        "ImageScale", "ImageUpscaleWithModel", "JoinImageWithAlpha", "KSampler",
        "LoadBackgroundRemovalModel", "LoadImage", "RemoveBackground", "SaveImage",
        "SetUnionControlNetType", "UltimateSDUpscale", "UpscaleModelLoader",
    }
    missing = sorted(required - set(info))
    if missing:
        raise RuntimeError("required ComfyUI nodes missing: " + ", ".join(missing))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--comfy-url", default=os.environ.get("COMFYUI_URL", "http://host.docker.internal:8188"))
    parser.add_argument("--output-dir", default="/opt/data/hermes/comfy-commercial-image-stack-verification")
    parser.add_argument("--timeout-seconds", type=int, default=1200)
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    info = request_json(args.comfy_url, "/object_info")
    require_nodes(info)
    results: dict[str, Any] = {"status": "running", "comfy_url": args.comfy_url, "output_dir": str(output_dir), "checks": {}}

    flux_path = output_dir / "flux-schnell-1216x832.png"
    results["checks"]["flux_schnell"] = run_workflow(args.comfy_url, flux_workflow("sdtk_verify/flux_schnell"), flux_path, args.timeout_seconds)
    results["checks"]["flux_schnell"]["png"] = inspect_png(flux_path)
    if (results["checks"]["flux_schnell"]["png"]["width"], results["checks"]["flux_schnell"]["png"]["height"]) != (1216, 832):
        raise RuntimeError("FLUX output dimensions are not 1216x832")

    uploaded_flux = upload_image(args.comfy_url, flux_path, "sdtk_verify_flux_schnell.png")
    free_models(args.comfy_url)

    control_path = output_dir / "sdxl-realvis-controlnet-canny-1024x704.png"
    results["checks"]["sdxl_controlnet"] = run_workflow(args.comfy_url, controlnet_workflow(uploaded_flux, "sdtk_verify/sdxl_controlnet"), control_path, args.timeout_seconds)
    results["checks"]["sdxl_controlnet"]["png"] = inspect_png(control_path)
    free_models(args.comfy_url)

    upscale_path = output_dir / "flux-realesrgan-2x-2432x1664.png"
    results["checks"]["realesrgan_2x"] = run_workflow(args.comfy_url, upscale_workflow(uploaded_flux, "sdtk_verify/realesrgan_2x"), upscale_path, args.timeout_seconds)
    results["checks"]["realesrgan_2x"]["png"] = inspect_png(upscale_path)
    if (results["checks"]["realesrgan_2x"]["png"]["width"], results["checks"]["realesrgan_2x"]["png"]["height"]) != (2432, 1664):
        raise RuntimeError("upscale output dimensions are not exactly 2x")
    free_models(args.comfy_url)

    product_path = output_dir / "flux-product-source-768x768.png"
    results["checks"]["birefnet_source"] = run_workflow(args.comfy_url, flux_workflow("sdtk_verify/birefnet_source", product=True), product_path, args.timeout_seconds)
    uploaded_product = upload_image(args.comfy_url, product_path, "sdtk_verify_birefnet_source.png")
    free_models(args.comfy_url)

    transparent_path = output_dir / "birefnet-product-transparent.png"
    results["checks"]["birefnet"] = run_workflow(args.comfy_url, birefnet_workflow(uploaded_product, "sdtk_verify/birefnet_transparent"), transparent_path, args.timeout_seconds)
    results["checks"]["birefnet"]["png"] = inspect_png(transparent_path)
    if not results["checks"]["birefnet"]["png"].get("alpha_useful"):
        raise RuntimeError("BiRefNet output did not contain both transparent and opaque pixels")

    results["status"] = "completed"
    results["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    result_path = output_dir / "verification-results.json"
    result_path.write_text(json.dumps(results, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
