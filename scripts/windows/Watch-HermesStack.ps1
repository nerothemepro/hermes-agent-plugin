param(
    [string]$ContainerName = "hermes-sandbox",
    [string]$LmStudioBaseUrl = "http://127.0.0.1:1234",
    [string]$Profiles = "",
    [string]$SharedModel = "google/gemma-4-26b-a4b-qat",
    [int]$IntervalSeconds = 180,
    [switch]$RunOnce,
    [switch]$ShowHealth,
    [switch]$AutoHeal,
    [string]$NotifyBotToken = "",
    [string]$NotifyChatId = ""
)

. "$PSScriptRoot/HermesHostCommon.ps1"

if (-not $AutoHeal.IsPresent) {
    $AutoHeal = $true
}

function Send-TelegramAlert {
    param(
        [string]$BotToken,
        [string]$ChatId,
        [string]$Message
    )

    if (-not $BotToken -or -not $ChatId) {
        return
    }

    try {
        Invoke-RestMethod -Method Post -Uri ("https://api.telegram.org/bot{0}/sendMessage" -f $BotToken) -Body @{
            chat_id = $ChatId
            text = $Message
        } | Out-Null
    }
    catch {
        Write-Step ("telegram alert failed: {0}" -f $_.Exception.Message)
    }
}

do {
    Write-Step "watchdog tick started"
    Start-LmsServerProcess
    Wait-LmsApi -BaseUrl $LmStudioBaseUrl
    Ensure-LmsModelLoaded -ModelId $SharedModel
    Ensure-DockerContainerStarted -ContainerName $ContainerName

    $effectiveProfiles = $Profiles
    if (-not $effectiveProfiles) {
        $effectiveProfiles = Get-DefaultHermesProfiles -ContainerName $ContainerName
    }

    Assert-ContainerSeesModel -ContainerName $ContainerName -ModelId $SharedModel
    Recover-HermesProfiles -ContainerName $ContainerName -Profiles $effectiveProfiles | Out-Null

    $healthJson = Invoke-DockerBash -ContainerName $ContainerName -Command ("python3 /workspace/hermes-agent-plugin/scripts/herorches_collect_health.py --profiles '{0}' --json" -f $effectiveProfiles)
    if ($ShowHealth) {
        Write-Output $healthJson
    }

    $health = $healthJson | ConvertFrom-Json
    $incidentCount = [int]$health.summary.incident_count
    if ($incidentCount -gt 0) {
        Write-Step ("watchdog detected {0} incident(s)" -f $incidentCount)
        if ($AutoHeal) {
            Invoke-DockerBash -ContainerName $ContainerName -Command ("bash /workspace/hermes-agent-plugin/scripts/herorches_safe_recover.sh --all") | Out-Null
        }
        $message = "Hermes watchdog detected $incidentCount incident(s) in profiles: " + (($health.profiles | Where-Object { $_.status -ne 'healthy' } | ForEach-Object { $_.name }) -join ', ')
        Send-TelegramAlert -BotToken $NotifyBotToken -ChatId $NotifyChatId -Message $message
    }
    else {
        Write-Step "watchdog health check is clean"
    }

    if ($RunOnce) {
        break
    }
    Start-Sleep -Seconds $IntervalSeconds
} while ($true)
