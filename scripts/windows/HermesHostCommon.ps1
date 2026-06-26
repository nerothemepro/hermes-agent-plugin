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

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    foreach ($arg in $Arguments) {
        [void]$psi.ArgumentList.Add($arg)
    }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        StdOut = $stdout
        StdErr = $stderr
        Combined = (($stdout + "`n" + $stderr).Trim())
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
