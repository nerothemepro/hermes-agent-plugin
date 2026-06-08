# Hermes Media Pipeline

Pipeline Huong B: Hermes goi script local, ComfyUI tao anh keyframe bang workflow Flux, sau do ComfyUI Wan2.1 I2V tao video tu keyframe. Wan API rieng tai `http://host.docker.internal:8010` chi giu lam fallback ve sau, khong phai duong chinh.

## Files

- `generate_video.py`: CLI chinh.
- `workflows/flux_keyframe_api.json`: workflow API JSON de tao keyframe. File hien tai la template; can thay bang workflow Flux export that hoac set dung model name sau khi cai Flux.
- `workflows/wan_i2v_api.json`: workflow Wan2.1 I2V 480p da smoke-test thanh cong voi ComfyUI.
- Anh output: `/opt/data/hermes/generated-images`
- Video output: `/opt/data/hermes/generated-videos`

## Chay script

Test nhe, gioi han Wan `frames=5`, `steps=1`; Flux `steps=4`:

```bash
python3 /workspace/projects/media-pipeline/generate_video.py   --prompt "mot chu dai bang lao xuong mat ho bat ca"   --mode test
```

Quality nhe hon muc production, van gioi han theo yeu cau `frames<=33`, `steps<=15`:

```bash
python3 /workspace/projects/media-pipeline/generate_video.py   --prompt "mot chu dai bang lao xuong mat ho bat ca"   --mode quality
```

Stdout JSON thanh cong:

```json
{
  "status": "completed",
  "image_path": "/opt/data/hermes/generated-images/...png",
  "video_path": "/opt/data/hermes/generated-videos/...mp4",
  "prompt_used": {
    "image": "...cinematic keyframe...",
    "video": "...smooth short video...",
    "negative": "..."
  },
  "errors": []
}
```

Neu loi, script in JSON `status:error` va `errors:[...]` ra stderr.

## Trang thai hien tai

Wan2.1 I2V trong ComfyUI da du va da smoke-test thanh cong:

- `wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors`
- `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
- `wan_2.1_vae.safetensors`
- `clip_vision_h.safetensors`
- `SaveVideo` xuat MP4/H264

Flux/keyframe chua du trong ComfyUI hien tai. `/object_info` dang khong expose Flux diffusion model, Flux text encoders, Flux AE, va `CheckpointLoaderSimple` cung chua co checkpoint anh. Vi vay `flux_keyframe_api.json` dang la template va script se dung o preflight cho den khi workflow Flux that duoc export/cai model.

## Cai/gan workflow Flux

Sau khi cai model Flux vao ComfyUI, mo browser `http://127.0.0.1:8188`, tao workflow text-to-image chay thanh cong, roi export API JSON thanh:

```text
/workspace/projects/media-pipeline/workflows/flux_keyframe_api.json
```

Script patch theo class node, khong phu thuoc node id co dinh:

- `CLIPTextEncode`: patch positive prompt va negative prompt neu co.
- `EmptyLatentImage`: patch width/height.
- `KSampler`: patch seed/steps.
- `FluxGuidance`: patch guidance neu node ton tai.
- `SaveImage`: patch filename prefix.

Co the override ten model bang env:

```bash
FLUX_UNET_NAME=flux1-dev-fp8.safetensors
FLUX_CLIP_NAME1=clip_l.safetensors
FLUX_CLIP_NAME2=t5xxl_fp8_e4m3fn.safetensors
FLUX_VAE_NAME=ae.safetensors
FLUX_GUIDANCE=3.5
```

## Wan I2V workflow

`workflows/wan_i2v_api.json` dung graph native ComfyUI:

- `UNETLoader`
- `CLIPLoader` type `wan`
- `VAELoader`
- `CLIPVisionLoader`
- `LoadImage`
- `WanImageToVideo`
- `KSampler`
- `VAEDecodeTiled`
- `CreateVideo`
- `SaveVideo`

Script se download keyframe tu ComfyUI `/view`, upload lai bang `/upload/image`, patch `LoadImage.image`, patch prompt, frames, steps, roi queue workflow Wan.

## Hermes goi script

Hermes Telegram handler chi can goi:

```bash
python3 /workspace/projects/media-pipeline/generate_video.py --prompt "$PROMPT" --mode test
```

Production co the dung `--mode quality` sau khi da on dinh VRAM/thoi gian. Hermes parse stdout JSON, neu `status == completed` thi lay `video_path` va goi Telegram attachment/video send. Neu adapter Telegram cua Hermes ho tro video native, gui file `.mp4` bang method `send_video(chat_id, video_path, caption, ...)`. Neu chi gui text, cau hinh web/static serving rieng roi gui link.

## Lenh kiem tra ComfyUI

```bash
curl http://host.docker.internal:8188/system_stats
curl http://host.docker.internal:8188/object_info/UNETLoader
curl http://host.docker.internal:8188/object_info/CLIPLoader
curl http://host.docker.internal:8188/object_info/VAELoader
curl http://host.docker.internal:8188/object_info/CLIPVisionLoader
```

## Loi thuong gap

- `flux_keyframe_api ... placeholder`: workflow Flux chua duoc thay bang API JSON that hoac chua set model env.
- `... is not exposed by ComfyUI`: file model khong nam dung folder ComfyUI hoac can restart ComfyUI.
- `LoadImage node to patch keyframe`: workflow Wan khong co `LoadImage`; export lai workflow I2V dung start image.
- Thieu VRAM: giam `frames`, `steps`, width/height; tat LM Studio/model khac dang chiem GPU.
- Workflow sai node/model: load workflow tren browser truoc, chay thanh cong, roi export lai API JSON.
