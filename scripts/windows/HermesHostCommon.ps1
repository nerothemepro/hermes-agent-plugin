Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[hermes-host] $Message"
}

function Invoke-LmsCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & lms @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "LM Studio CLI failed: lms $($Arguments -join ' ')"
    }
}

function Start-LmsServerProcess {
    Write-Step "starting LM Studio server process"
    Start-Process -FilePath "lms" -ArgumentList @("server", "start") -WindowStyle Hidden | Out-Null
}

function Test-LmsApi {
    param([string]$BaseUrl = "http://127.0.0.1:1234")

    try {
        Invoke-RestMethod -Uri "$BaseUrl/v1/models" -Method Get -TimeoutSec 5 | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Wait-LmsApi {
    param(
        [string]$BaseUrl = "http://127.0.0.1:1234",
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-LmsApi -BaseUrl $BaseUrl) {
            Write-Step "LM Studio API is ready at $BaseUrl"
            return
        }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for LM Studio API at $BaseUrl"
}

function Get-LmsLoadedModelsText {
    $output = & lms ps 2>$null | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "LM Studio CLI failed: lms ps"
    }
    return $output
}

function Ensure-LmsModelLoaded {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ModelId
    )

    $loaded = Get-LmsLoadedModelsText
    if ($loaded -match [regex]::Escape($ModelId)) {
        Write-Step "model already loaded: $ModelId"
        return
    }

    Write-Step "loading model: $ModelId"
    Invoke-LmsCommand -Arguments @("load", $ModelId)
}

function Ensure-DockerContainerStarted {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName
    )

    Write-Step "starting Docker container: $ContainerName"
    & docker start $ContainerName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "docker start failed for container: $ContainerName"
    }
}

function Invoke-DockerBash {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName,
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    & docker exec $ContainerName bash -lc $Command
    if ($LASTEXITCODE -ne 0) {
        throw ("docker exec failed for container {0}: {1}" -f $ContainerName, $Command)
    }
}

function Recover-HermesProfiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName,
        [string]$Profiles = "hervid herresearch herdev hertran herwiki hersocial"
    )

    Write-Step "recovering Hermes gateways in container: $Profiles"
    $cmd = "HERMES_PROFILES='$Profiles' bash /workspace/hermes-agent-plugin/scripts/herprofiles_recover.sh"
    Invoke-DockerBash -ContainerName $ContainerName -Command $cmd
}

function Show-HermesStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName,
        [string]$Profiles = "hervid herresearch herdev hertran herwiki hersocial"
    )

    foreach ($profile in $Profiles.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)) {
        Write-Step "status: $profile"
        Invoke-DockerBash -ContainerName $ContainerName -Command "bash /workspace/hermes-agent-plugin/scripts/herprofile_status.sh $profile"
    }
}
