Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[hermes-host] $Message"
}

function Invoke-NativeCapture {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = & $FilePath @Arguments 2>&1 | ForEach-Object { "$_" }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    $combined = (($lines | Out-String).Trim())
    return [pscustomobject]@{
        ExitCode = $exitCode
        StdOut = $combined
        StdErr = ""
        Combined = $combined
    }
}

function Invoke-LmsCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $result = Invoke-NativeCapture -FilePath "lms" -Arguments $Arguments
    if ($result.ExitCode -ne 0) {
        throw ("LM Studio CLI failed: lms {0}`n{1}" -f ($Arguments -join ' '), $result.Combined)
    }
    return $result
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
    $result = Invoke-NativeCapture -FilePath "lms" -Arguments @("ps")
    if ($result.ExitCode -ne 0) {
        if ($result.Combined -match "No models are currently loaded") {
            return ""
        }
        throw ("LM Studio CLI failed: lms ps`n{0}" -f $result.Combined)
    }
    return $result.Combined
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
    [void](Invoke-LmsCommand -Arguments @("load", $ModelId))
}

function Assert-LmsModelLoaded {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ModelId
    )

    $loaded = Get-LmsLoadedModelsText
    if ($loaded -notmatch [regex]::Escape($ModelId)) {
        throw ("LM Studio model is not loaded: {0}`nCurrent models:`n{1}" -f $ModelId, $loaded)
    }
    Write-Step "verified loaded model: $ModelId"
    if ($loaded) {
        Write-Output $loaded
    }
}

function Assert-ContainerSeesModel {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName,
        [Parameter(Mandatory = $true)]
        [string]$ModelId,
        [string]$LmStudioBaseUrl = "http://host.docker.internal:1234"
    )

    $cmd = "curl -fsS '$LmStudioBaseUrl/v1/models' | jq -r '.data[].id'"
    $result = Invoke-NativeCapture -FilePath "docker" -Arguments @("exec", $ContainerName, "bash", "-lc", $cmd)
    if ($result.ExitCode -ne 0) {
        throw ("container model visibility check failed for {0}`n{1}" -f $ModelId, $result.Combined)
    }
    if ($result.Combined -notmatch [regex]::Escape($ModelId)) {
        throw ("container cannot see LM Studio model {0}`n{1}" -f $ModelId, $result.Combined)
    }
    Write-Step "verified container-visible model: $ModelId"
    if ($result.Combined) {
        Write-Output $result.Combined
    }
}

function Ensure-DockerContainerStarted {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName
    )

    Write-Step "starting Docker container: $ContainerName"
    $result = Invoke-NativeCapture -FilePath "docker" -Arguments @("start", $ContainerName)
    if ($result.ExitCode -ne 0) {
        throw ("docker start failed for container {0}`n{1}" -f $ContainerName, $result.Combined)
    }
}

function Invoke-DockerBash {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerName,
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    $result = Invoke-NativeCapture -FilePath "docker" -Arguments @("exec", $ContainerName, "bash", "-lc", $Command)
    if ($result.ExitCode -ne 0) {
        throw ("docker exec failed for container {0}: {1}`n{2}" -f $ContainerName, $Command, $result.Combined)
    }
    if ($result.StdOut) {
        Write-Output $result.StdOut.TrimEnd()
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
