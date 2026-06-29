param(
    [string]$ContainerName = "hermes-sandbox",
    [string]$LmStudioBaseUrl = "http://127.0.0.1:1234",
    [string]$Profiles = "",
    [string]$SharedModel = "google/gemma-4-26b-a4b-qat",
    [int]$IntervalSeconds = 180,
    [int]$HealthTimeoutSeconds = 20,
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

function Format-IncidentSummary {
    param($Report)

    $names = @(Get-HermesIncidentNames -Report $Report)
    if ($names.Count -eq 0) {
        return "none"
    }
    return ($names -join ', ')
}

do {
    $tickExitCode = 0
    $effectiveProfiles = $Profiles
    if (-not $effectiveProfiles) {
        $effectiveProfiles = Get-DefaultHermesProfiles -ContainerName $ContainerName
    }

    try {
        Write-Step "watchdog tick started"
        Start-LmsServerProcess -BaseUrl $LmStudioBaseUrl | Out-Null
        Wait-LmsApi -BaseUrl $LmStudioBaseUrl
        Ensure-LmsModelLoaded -ModelId $SharedModel
        Assert-LmsModelLoaded -ModelId $SharedModel | Out-Null
        Ensure-DockerContainerStarted -ContainerName $ContainerName
        Assert-ContainerSeesModel -ContainerName $ContainerName -ModelId $SharedModel | Out-Null

        $healthState = Invoke-HermesHealthReportObject -ContainerName $ContainerName -Profiles $effectiveProfiles -LogLines 20 -TimeoutSeconds $HealthTimeoutSeconds
        $report = $healthState.Report
        $preIncidentCount = [int]$report.summary.incident_count
        $postHealthState = $healthState

        if ($preIncidentCount -gt 0) {
            $preSummary = Format-IncidentSummary -Report $report
            Write-Step ("watchdog detected {0} incident(s) before auto-heal: {1}" -f $preIncidentCount, $preSummary)

            if ($AutoHeal) {
                Write-Step "watchdog invoking bounded safe recovery"
                Invoke-HermesSafeRecover -ContainerName $ContainerName -Profiles $effectiveProfiles | Out-Null
                $postHealthState = Invoke-HermesHealthReportObject -ContainerName $ContainerName -Profiles $effectiveProfiles -LogLines 20 -TimeoutSeconds $HealthTimeoutSeconds
                $postReport = $postHealthState.Report
                $postIncidentCount = [int]$postReport.summary.incident_count
                if ($postIncidentCount -eq 0) {
                    Write-Step ("watchdog recovered all incidents: {0}" -f $preSummary)
                }
                else {
                    $postSummary = Format-IncidentSummary -Report $postReport
                    Write-Step ("watchdog incidents remain after recovery ({0}): {1}" -f $postIncidentCount, $postSummary)
                    $tickExitCode = 2
                    $message = "Hermes watchdog still sees $postIncidentCount incident(s): $postSummary"
                    Send-TelegramAlert -BotToken $NotifyBotToken -ChatId $NotifyChatId -Message $message
                }
            }
            else {
                Write-Step "watchdog auto-heal disabled; incidents left untouched"
                $tickExitCode = 2
                $message = "Hermes watchdog detected $preIncidentCount incident(s): $preSummary"
                Send-TelegramAlert -BotToken $NotifyBotToken -ChatId $NotifyChatId -Message $message
            }
        }
        else {
            Write-Step "watchdog health check is clean"
        }

        if ($ShowHealth) {
            Write-Output $postHealthState.RawJson
        }
    }
    catch {
        $tickExitCode = 3
        $failureMessage = $_.Exception.Message
        Write-Step ("watchdog failed: {0}" -f $failureMessage)
        Send-TelegramAlert -BotToken $NotifyBotToken -ChatId $NotifyChatId -Message ("Hermes watchdog hard failure: {0}" -f $failureMessage)
    }

    if ($RunOnce) {
        exit $tickExitCode
    }

    Start-Sleep -Seconds $IntervalSeconds
} while ($true)
