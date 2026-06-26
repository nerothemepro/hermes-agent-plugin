param(
    [string]$LmStudioBaseUrl = "http://127.0.0.1:1234",
    [switch]$ShowLoadedModels
)

. "$PSScriptRoot/HermesHostCommon.ps1"

Write-Step "warming HerDev model"
Wait-LmsApi -BaseUrl $LmStudioBaseUrl
Ensure-LmsModelLoaded -ModelId "qwen/qwen3.6-27b"

if ($ShowLoadedModels) {
    Write-Step "currently loaded models"
    & lms ps
}
