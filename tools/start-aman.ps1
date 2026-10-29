param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 3000,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverPath = Join-Path $projectRoot 'server.js'
$siteUrl = "http://127.0.0.1:$Port"
$mutexOwned = $false
$launchMutex = $null

function Test-AmanSite {
    try {
        $settings = Invoke-RestMethod -Uri "$siteUrl/api/tobi/config" -TimeoutSec 2
        if ($null -eq $settings.config -or $null -eq $settings.config.answers -or $null -eq $settings.revision) { return $false }
        $homePage = Invoke-WebRequest -Uri "$siteUrl/index.html" -UseBasicParsing -TimeoutSec 2
        return $homePage.Content.Contains('data-page="home"') -and $homePage.Content.Contains('aman-experience.css')
    }
    catch { return $false }
}

function Test-LocalPort {
    $probe = New-Object System.Net.Sockets.TcpClient
    try {
        $connection = $probe.ConnectAsync('127.0.0.1', $Port)
        return $connection.Wait(500) -and $probe.Connected
    }
    catch { return $false }
    finally { $probe.Dispose() }
}

try {
    if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) { throw 'The website files are missing. Keep Open Aman.cmd inside the website folder.' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $identifier = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("$projectRoot|$Port"))).Replace('-', '').Substring(0, 20) }
    finally { $sha.Dispose() }
    $launchMutex = New-Object System.Threading.Mutex($false, "Local\AmanLauncher-$identifier")
    try { $mutexOwned = $launchMutex.WaitOne(15000) }
    catch [System.Threading.AbandonedMutexException] { $mutexOwned = $true }
    if (-not $mutexOwned) { throw 'Another Aman launcher is still starting the website. Please try again in a moment.' }

    if (-not (Test-AmanSite)) {
        if (Test-LocalPort) { throw "Port $Port is being used by another application. Close that application or run tools/start-aman.ps1 with -Port and a different port number." }
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand) { throw 'Install Node.js 24 or newer, then open Open Aman.cmd again. https://nodejs.org/' }
        $nodeVersion = & $nodeCommand.Source --version
        if ($nodeVersion -notmatch '^v(\d+)\.(\d+)\.') { throw 'Could not check the Node.js version.' }
        if ([int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 13)) { throw 'Aman needs Node.js 22.13 or newer. Install Node.js 24 or newer, then try again.' }

        $runtimeDir = Join-Path $projectRoot '.data'
        if (-not (Test-Path -LiteralPath $runtimeDir -PathType Container)) { New-Item -ItemType Directory -Path $runtimeDir | Out-Null }
        $serverOutput = Join-Path $runtimeDir 'aman-launcher.out.log'
        $serverErrors = Join-Path $runtimeDir 'aman-launcher.error.log'
        $previousPort = $env:PORT
        $previousHost = $env:HOST
        try {
            $env:PORT = [string]$Port
            $env:HOST = '127.0.0.1'
            $serverProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $serverOutput -RedirectStandardError $serverErrors -PassThru
        }
        finally {
            $env:PORT = $previousPort
            $env:HOST = $previousHost
        }
        Set-Content -LiteralPath (Join-Path $runtimeDir 'aman-server.pid') -Value $serverProcess.Id -Encoding ASCII
        $ready = $false
        $startupTimer = [System.Diagnostics.Stopwatch]::StartNew()
        while ($startupTimer.Elapsed.TotalSeconds -lt 15) {
            if (Test-AmanSite) { $ready = $true; break }
            $serverProcess.Refresh()
            if ($serverProcess.HasExited) { throw "The website server could not start. Details are in .data/aman-launcher.error.log." }
            Start-Sleep -Milliseconds 250
        }
        if (-not $ready) { throw "The website is taking longer than expected to start. Try $siteUrl in your browser, or check .data/aman-launcher.error.log." }
    }

    Write-Output "Aman is ready at $siteUrl"
    if (-not $NoBrowser) { Start-Process -FilePath $siteUrl }
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
finally {
    if ($mutexOwned) { $launchMutex.ReleaseMutex() }
    if ($null -ne $launchMutex) { $launchMutex.Dispose() }
}
