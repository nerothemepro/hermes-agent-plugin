param(
    [string]$ContainerName = "hermes-sandbox",
    [string]$LmStudioBaseUrl = "http://127.0.0.1:1234",
    [string]$Profiles = "",
    [string]$SharedModel = "google/gemma-4-26b-a4b-qat",
    [switch]$WarmHerVid,
    [switch]$SkipHerVidWarmup,
    [switch]$WarmHerDev,
    [switch]$SkipHerDevWarmup,
    [switch]$ShowStatus
)

. "$PSScriptRoot/HermesHostCommon.ps1"

Write-Step "bootstrapping LM Studio + Hermes stack"
Write-Step "assumption: per-model defaults are already saved in LM Studio"

Start-LmsServerProcess -BaseUrl $LmStudioBaseUrl
Wait-LmsApi -BaseUrl $LmStudioBaseUrl

Ensure-LmsModelLoaded -ModelId $SharedModel
Assert-LmsModelLoaded -ModelId $SharedModel

$HerVidModel = "google/gemma-4-12b-qat"
$ShouldWarmHerVid = $WarmHerVid.IsPresent -or (-not $SkipHerVidWarmup.IsPresent)
if ($ShouldWarmHerVid) {
    Write-Step "warming HerVid model by default to avoid LM Studio auto-load with undersized context"
    Ensure-LmsModelLoaded -ModelId $HerVidModel
    Assert-LmsModelLoaded -ModelId $HerVidModel
}
else {
    Write-Step "skipping HerVid warm-up by request"
}

$HerDevModel = "qwen/qwen3.6-27b"
$ShouldWarmHerDev = $WarmHerDev.IsPresent -or (-not $SkipHerDevWarmup.IsPresent)
if ($ShouldWarmHerDev) {
    Write-Step "warming HerDev model by default for coding/SDTK tasks"
    Ensure-LmsModelLoaded -ModelId $HerDevModel
    Assert-LmsModelLoaded -ModelId $HerDevModel
}
else {
    Write-Step "skipping HerDev warm-up by request"
}

Ensure-DockerContainerStarted -ContainerName $ContainerName

$EffectiveProfiles = $Profiles
if (-not $EffectiveProfiles) {
    $EffectiveProfiles = Get-DefaultHermesProfiles -ContainerName $ContainerName
}

Assert-ContainerSeesModel -ContainerName $ContainerName -ModelId $SharedModel
if ($ShouldWarmHerVid) {
    Assert-ContainerSeesModel -ContainerName $ContainerName -ModelId $HerVidModel
}
if ($ShouldWarmHerDev) {
    Assert-ContainerSeesModel -ContainerName $ContainerName -ModelId $HerDevModel
}
Recover-HermesProfiles -ContainerName $ContainerName -Profiles $EffectiveProfiles

if ($ShowStatus) {
    Show-HermesStatus -ContainerName $ContainerName -Profiles $EffectiveProfiles
}

Write-Step "startup flow completed"
