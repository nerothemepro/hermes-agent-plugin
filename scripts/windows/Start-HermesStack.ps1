param(
    [string]$ContainerName = "hermes-sandbox",
    [string]$LmStudioBaseUrl = "http://127.0.0.1:1234",
    [string]$Profiles = "",
    [string]$SharedModel = "google/gemma-4-26b-a4b-qat",
    [switch]$WarmHerVid,
    [switch]$WarmHerDev,
    [switch]$ShowStatus
)

. "$PSScriptRoot/HermesHostCommon.ps1"

Write-Step "bootstrapping LM Studio + Hermes stack"
Write-Step "assumption: per-model defaults are already saved in LM Studio"

Start-LmsServerProcess -BaseUrl $LmStudioBaseUrl
Wait-LmsApi -BaseUrl $LmStudioBaseUrl

Ensure-LmsModelLoaded -ModelId $SharedModel
Assert-LmsModelLoaded -ModelId $SharedModel

if ($WarmHerVid) {
    Ensure-LmsModelLoaded -ModelId "google/gemma-4-12b-qat"
    Assert-LmsModelLoaded -ModelId "google/gemma-4-12b-qat"
}

if ($WarmHerDev) {
    Ensure-LmsModelLoaded -ModelId "qwen/qwen3.6-27b"
    Assert-LmsModelLoaded -ModelId "qwen/qwen3.6-27b"
}

Ensure-DockerContainerStarted -ContainerName $ContainerName

$EffectiveProfiles = $Profiles
if (-not $EffectiveProfiles) {
    $EffectiveProfiles = Get-DefaultHermesProfiles -ContainerName $ContainerName
}

Assert-ContainerSeesModel -ContainerName $ContainerName -ModelId $SharedModel
Recover-HermesProfiles -ContainerName $ContainerName -Profiles $EffectiveProfiles

if ($ShowStatus) {
    Show-HermesStatus -ContainerName $ContainerName -Profiles $EffectiveProfiles
}

Write-Step "startup flow completed"
