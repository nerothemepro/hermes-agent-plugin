param(
    [string]$LmStudioBaseUrl = "http://127.0.0.1:1234",
    [switch]$ShowLoadedModels
)

. "$PSScriptRoot/HermesHostCommon.ps1"

Write-Step "warming HerVid model"
Wait-LmsApi -BaseUrl $LmStudioBaseUrl
Ensure-LmsModelLoaded -ModelId "google/gemma-4-12b-qat"

if ($ShowLoadedModels) {
    Write-Step "currently loaded models"
    & lms ps
}
