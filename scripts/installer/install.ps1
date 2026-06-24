param(
  [switch]$Quiet,
  [switch]$NoDesktopShortcut,
  [switch]$Autostart,
  [switch]$Uninstall,
  [switch]$DeleteUserData,
  [switch]$SelfTest,
  [int]$SelfTestPort = 33210,
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$AppName = "MiMo Bridge"
$AppId = "MiMoBridge"
$AppVersion = "0.1.0"
$TaskName = "MiMoBridge-Launcher"

function Get-SetupLogPath {
  try {
    $localAppData = Get-LocalAppData
    $dataRoot = Join-Path $localAppData "MiMoBridge"
    New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
    return Join-Path $dataRoot "setup.log"
  } catch {
    return Join-Path ([System.IO.Path]::GetTempPath()) "mimo-bridge-setup.log"
  }
}

function Write-SetupLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = "[" + (Get-Date).ToUniversalTime().ToString("o") + "] " + $Message
  try {
    Add-Content -LiteralPath (Get-SetupLogPath) -Value $line -Encoding UTF8
  } catch {
    Write-Verbose $line
  }
}

function Get-LocalAppData {
  $value = [Environment]::GetFolderPath("LocalApplicationData")
  if (-not $value) {
    throw "Cannot resolve LOCALAPPDATA."
  }
  return $value
}

function Get-AppData {
  $value = [Environment]::GetFolderPath("ApplicationData")
  if (-not $value) {
    throw "Cannot resolve APPDATA."
  }
  return $value
}

function Get-DesktopDir {
  $value = [Environment]::GetFolderPath("DesktopDirectory")
  if (-not $value) {
    return Join-Path ([Environment]::GetFolderPath("UserProfile")) "Desktop"
  }
  return $value
}

function Assert-SupportedWindows {
  $version = [Environment]::OSVersion.Version
  if ($version.Major -lt 10) {
    throw "This installer supports Windows 10/11 x64 only."
  }
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw "This installer supports x64 Windows only."
  }
}

function Add-TrailingSlash {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
}

function Test-UnderPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullParent = Add-TrailingSlash $Parent
  return $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-UnderPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  if (-not (Test-UnderPath -Path $Path -Parent $Parent)) {
    throw "Refusing to modify path outside expected parent: $Path"
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Read-YesNo {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [Parameter(Mandatory = $true)][bool]$Default
  )
  $suffix = if ($Default) { " [Y/n] " } else { " [y/N] " }
  $answer = Read-Host ($Prompt + $suffix)
  if (-not $answer) {
    return $Default
  }
  return $answer.Trim().ToLowerInvariant() -in @("y", "yes")
}

function Resolve-InstallDir {
  $localAppData = Get-LocalAppData
  if ($InstallDir) {
    $resolved = [System.IO.Path]::GetFullPath($InstallDir)
  } else {
    $registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
    $registered = Get-ItemProperty -Path $registryPath -Name InstallLocation -ErrorAction SilentlyContinue
    if ($Uninstall -and $registered -and $registered.InstallLocation) {
      $resolved = [System.IO.Path]::GetFullPath($registered.InstallLocation)
    } else {
      $resolved = Join-Path $localAppData "MiMoBridgeApp"
    }
  }
  Assert-UnderPath -Path $resolved -Parent $localAppData
  return $resolved
}

function Get-Paths {
  $localAppData = Get-LocalAppData
  $appData = Get-AppData
  $installRoot = Resolve-InstallDir
  $dataRoot = Join-Path $localAppData "MiMoBridge"
  return [pscustomobject]@{
    InstallRoot = $installRoot
    DataRoot = $dataRoot
    ConfigPath = Join-Path $dataRoot "config.json"
    StartMenuDir = Join-Path $appData "Microsoft\Windows\Start Menu\Programs\MiMo Bridge"
    DesktopShortcut = Join-Path (Get-DesktopDir) "MiMo Bridge.lnk"
    LauncherCmd = Join-Path $installRoot "MiMo Bridge Launcher.cmd"
    StartCmd = Join-Path $installRoot "Start MiMo Bridge.cmd"
    StopCmd = Join-Path $installRoot "Stop MiMo Bridge.cmd"
    ConfigureCmd = Join-Path $installRoot "Configure MiMo Bridge.cmd"
    MaintenanceScript = Join-Path $installRoot "installer-maintenance.ps1"
  }
}

function Remove-KnownChild {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $path = Join-Path $Parent $Name
  Assert-UnderPath -Path $path -Parent $Parent
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

function Copy-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [bool]$SkipTopLevelData = $false
  )
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    if ($SkipTopLevelData -and $item.PSIsContainer -and $item.Name -ieq "data") {
      continue
    }
    $target = Join-Path $Destination $item.Name
    if ($item.PSIsContainer) {
      Copy-Directory -Source $item.FullName -Destination $target -SkipTopLevelData $false
    } else {
      Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    }
  }
}

function Invoke-LauncherCommand {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)][string]$Command,
    [int]$TimeoutMs = 20000
  )
  if (-not (Test-Path -LiteralPath $Paths.LauncherCmd)) {
    return [pscustomobject]@{
      Ran = $false
      ExitCode = $null
      Stdout = ""
      Stderr = "Launcher command is missing: $($Paths.LauncherCmd)"
      TimedOut = $false
    }
  }

  $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-installer-launcher-" + [guid]::NewGuid().ToString("N") + ".out")
  $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-installer-launcher-" + [guid]::NewGuid().ToString("N") + ".err")
  $wrapperPath = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-installer-launcher-" + [guid]::NewGuid().ToString("N") + ".cmd")
  try {
    $wrapper = "@echo off" + [Environment]::NewLine + 'call "' + $Paths.LauncherCmd + '" ' + $Command + " -Json" + [Environment]::NewLine
    [System.IO.File]::WriteAllText($wrapperPath, $wrapper, [System.Text.Encoding]::ASCII)
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $wrapperPath) -WorkingDirectory $Paths.InstallRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
    $timedOut = -not $process.WaitForExit($TimeoutMs)
    if ($timedOut) {
      try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    return [pscustomobject]@{
      Ran = $true
      ExitCode = if ($timedOut) { $null } else { $process.ExitCode }
      Stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue } else { "" }
      Stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue } else { "" }
      TimedOut = $timedOut
    }
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath, $wrapperPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-ConfiguredPort {
  param([Parameter(Mandatory = $true)]$Paths)
  if (Test-Path -LiteralPath $Paths.ConfigPath) {
    try {
      $config = Get-Content -LiteralPath $Paths.ConfigPath -Raw | ConvertFrom-Json
      if ($null -ne $config.port) {
        $port = [int]$config.port
        if ($port -ge 1 -and $port -le 65535) {
          return $port
        }
      }
    } catch {
      Write-SetupLog "Could not read configured port from $($Paths.ConfigPath): $($_.Exception.Message)"
    }
  }
  return 3210
}

function Test-HttpHealth {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutSec = 2
  )
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec $TimeoutSec
    if ($response.StatusCode -ne 200) {
      return $false
    }
    $parsed = $response.Content | ConvertFrom-Json
    return [bool]($parsed.ok -eq $true -and $parsed.data.daemon.status -eq "ok" -and $parsed.data.security.localhost_only -eq $true)
  } catch {
    return $false
  }
}

function Get-PortOwner {
  param([Parameter(Mandatory = $true)][int]$Port)
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) {
      return $null
    }
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $connection.OwningProcess) -ErrorAction SilentlyContinue
    return [pscustomobject]@{
      Pid = [int]$connection.OwningProcess
      Name = if ($process) { $process.Name } else { $null }
      CommandLine = if ($process) { $process.CommandLine } else { $null }
    }
  } catch {
    return $null
  }
}

function Test-InstallFileLocked {
  param([Parameter(Mandatory = $true)][string]$InstallRoot)
  if (-not (Test-Path -LiteralPath $InstallRoot)) {
    return $false
  }
  $candidates = Get-ChildItem -LiteralPath $InstallRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @("conpty.node", "node.exe", "index.js") }
  if (-not $candidates) {
    return $false
  }
  foreach ($candidate in $candidates) {
    try {
      $stream = [System.IO.File]::Open($candidate.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $stream.Close()
    } catch {
      Write-SetupLog "Install file appears locked: $($candidate.FullName) - $($_.Exception.Message)"
      return $true
    }
  }
  return $false
}

function Assert-InstalledDaemonStopped {
  param([Parameter(Mandatory = $true)]$Paths)
  $port = Get-ConfiguredPort -Paths $Paths

  if (Test-Path -LiteralPath $Paths.StopCmd) {
    Write-SetupLog "Stopping installed daemon with $($Paths.StopCmd)"
    $stop = Invoke-LauncherCommand -Paths $Paths -Command "stop" -TimeoutMs 30000
    Write-SetupLog "Stop command ran=$($stop.Ran) exit=$($stop.ExitCode) timedOut=$($stop.TimedOut) stdout=$($stop.Stdout) stderr=$($stop.Stderr)"
    if ($stop.TimedOut) {
      throw "MiMo Bridge is still running and the installer could not stop it. Close MiMo Bridge, or reboot Windows, then run this installer again."
    }
  } elseif (Test-Path -LiteralPath $Paths.InstallRoot) {
    Write-SetupLog "Stop launcher is missing; verifying port and file locks before upgrade."
  }

  $deadline = (Get-Date).AddSeconds(30)
  do {
    if (-not (Test-HttpHealth -Port $port)) {
      $owner = Get-PortOwner -Port $port
      if (-not $owner) {
        break
      }
      $commandLine = [string]$owner.CommandLine
      if ($commandLine -and $commandLine.IndexOf($Paths.InstallRoot, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        break
      }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  if (Test-HttpHealth -Port $port) {
    throw "MiMo Bridge is still responding on port $port. Close MiMo Bridge, or reboot Windows, then run this installer again."
  }

  $portOwner = Get-PortOwner -Port $port
  if ($portOwner -and ([string]$portOwner.CommandLine).IndexOf($Paths.InstallRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    throw "MiMo Bridge still owns port $port (PID $($portOwner.Pid)). Close it, or reboot Windows, then run this installer again."
  }

  if (Test-InstallFileLocked -InstallRoot $Paths.InstallRoot) {
    throw "Installed MiMo Bridge files are still locked. Close MiMo Bridge, or reboot Windows, then run this installer again. No installed files were removed."
  }
}

function Test-StagedPayload {
  param([Parameter(Mandatory = $true)][string]$StageRoot)
  $requiredFiles = @(
    "node\node.exe",
    "app\apps\local-daemon\dist\apps\local-daemon\src\index.js",
    "app\apps\local-daemon\dist\apps\local-daemon\src\launcher-cli.js",
    "app\apps\local-daemon\launcher.ps1",
    "app\apps\admin-ui\dist\index.html"
  )
  foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $StageRoot $relativePath))) {
      throw "Prepared installer payload missing required file: $relativePath"
    }
  }
}

function Move-ChildIfExists {
  param(
    [Parameter(Mandatory = $true)][string]$SourceParent,
    [Parameter(Mandatory = $true)][string]$DestinationParent,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $source = Join-Path $SourceParent $Name
  if (Test-Path -LiteralPath $source) {
    Move-Item -LiteralPath $source -Destination (Join-Path $DestinationParent $Name)
    return $true
  }
  return $false
}

function Install-StagedPayload {
  param(
    [Parameter(Mandatory = $true)]$Paths,
    [Parameter(Mandatory = $true)][string]$StageRoot
  )
  Test-StagedPayload -StageRoot $StageRoot
  New-Item -ItemType Directory -Force -Path $Paths.InstallRoot | Out-Null
  $backupRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-install-backup-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  $itemsMovedToBackup = $false
  $cleanupBackup = $true
  try {
    $itemsMovedToBackup = (Move-ChildIfExists -SourceParent $Paths.InstallRoot -DestinationParent $backupRoot -Name "app") -or $itemsMovedToBackup
    $itemsMovedToBackup = (Move-ChildIfExists -SourceParent $Paths.InstallRoot -DestinationParent $backupRoot -Name "node") -or $itemsMovedToBackup
    $itemsMovedToBackup = (Move-ChildIfExists -SourceParent $Paths.InstallRoot -DestinationParent $backupRoot -Name "data") -or $itemsMovedToBackup
    foreach ($cmdFile in Get-ChildItem -LiteralPath $Paths.InstallRoot -Filter "*.cmd" -Force -ErrorAction SilentlyContinue) {
      Move-Item -LiteralPath $cmdFile.FullName -Destination (Join-Path $backupRoot $cmdFile.Name)
      $itemsMovedToBackup = $true
    }

    Copy-Directory -Source $StageRoot -Destination $Paths.InstallRoot -SkipTopLevelData $true
  } catch {
    if ($itemsMovedToBackup -or (Get-ChildItem -LiteralPath $backupRoot -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      $cleanupBackup = $false
      try {
        Remove-KnownChild -Parent $Paths.InstallRoot -Name "app"
        Remove-KnownChild -Parent $Paths.InstallRoot -Name "node"
        Remove-KnownChild -Parent $Paths.InstallRoot -Name "data"
        Get-ChildItem -LiteralPath $Paths.InstallRoot -Filter "*.cmd" -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        Copy-Directory -Source $backupRoot -Destination $Paths.InstallRoot -SkipTopLevelData $false
        $cleanupBackup = $true
      } catch {
        Write-SetupLog "Rollback failed. Backup preserved at $backupRoot. Error: $($_.Exception.Message)"
        throw "Install failed and rollback could not be completed. The previous app backup is preserved at $backupRoot. Original error: $($_.Exception.Message)"
      }
    }
    throw
  } finally {
    if ($cleanupBackup) {
      Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Test-InstallerPayload {
  Assert-SupportedWindows
  $payloadZip = Join-Path $PSScriptRoot "MiMoBridge-payload.zip"
  if (-not (Test-Path -LiteralPath $payloadZip)) {
    throw "Missing installer payload: $payloadZip"
  }

  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-selftest-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  try {
    Expand-Archive -LiteralPath $payloadZip -DestinationPath $tempRoot -Force
    $payloadRoot = Join-Path $tempRoot "MiMoBridge"
    if (-not (Test-Path -LiteralPath $payloadRoot)) {
      $payloadRoot = $tempRoot
    }

    $requiredFiles = @(
      "node\node.exe",
      "app\apps\local-daemon\dist\apps\local-daemon\src\index.js",
      "app\apps\local-daemon\dist\apps\local-daemon\src\launcher-cli.js",
      "app\apps\local-daemon\launcher.ps1",
      "app\apps\admin-ui\dist\index.html",
      "MiMo Bridge Launcher.cmd",
      "Start MiMo Bridge.cmd",
      "Stop MiMo Bridge.cmd",
      "Configure MiMo Bridge.cmd"
    )
    foreach ($relativePath in $requiredFiles) {
      $path = Join-Path $payloadRoot $relativePath
      if (-not (Test-Path -LiteralPath $path)) {
        throw "Installer payload missing required file: $relativePath"
      }
    }

    $forbiddenPaths = @("runtime", "worktrees", "tasks", ".git", "data\config.json", "data\tasks", "data\launcher-state.json", "data\daemon.out.log", "data\daemon.err.log")
    foreach ($relativePath in $forbiddenPaths) {
      $path = Join-Path $payloadRoot $relativePath
      if (Test-Path -LiteralPath $path) {
        throw "Installer payload includes forbidden runtime data: $relativePath"
      }
    }

    $dataDir = Join-Path $payloadRoot "data"
    if ((Test-Path -LiteralPath $dataDir) -and (Get-ChildItem -LiteralPath $dataDir -Force -Recurse | Select-Object -First 1)) {
      throw "Installer payload data directory must be empty."
    }

    $sensitiveFiles = Get-ChildItem -LiteralPath $payloadRoot -Force -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @("auth.json", "mimocode.jsonc") } |
      Select-Object -First 1
    if ($sensitiveFiles) {
      throw "Installer payload includes a sensitive file: $($sensitiveFiles.FullName)"
    }

    Test-ExtractedPayloadSmoke -PayloadRoot $payloadRoot -Port $SelfTestPort
    Write-Host "MiMo Bridge installer self-test passed."
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Test-ExtractedPayloadSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [Parameter(Mandatory = $true)][int]$Port
  )
  if ($Port -lt 1 -or $Port -gt 65535) {
    throw "SelfTestPort must be between 1 and 65535."
  }
  $dataRoot = Join-Path $PayloadRoot "data"
  $configPath = Join-Path $dataRoot "config.json"
  New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
  $config = [ordered]@{
    port = $Port
    runtimeDir = Join-Path $dataRoot "runtime"
  }
  Write-Utf8NoBom -Path $configPath -Content (($config | ConvertTo-Json -Depth 4) + [Environment]::NewLine)

  $nodePath = Join-Path $PayloadRoot "node\node.exe"
  $appRoot = Join-Path $PayloadRoot "app"
  $entryPath = Join-Path $appRoot "apps\local-daemon\dist\apps\local-daemon\src\index.js"
  $stdoutPath = Join-Path $dataRoot "selftest-daemon.out.log"
  $stderrPath = Join-Path $dataRoot "selftest-daemon.err.log"
  if (-not (Test-Path -LiteralPath $nodePath)) {
    throw "Self-test node.exe is missing: $nodePath"
  }
  if (-not (Test-Path -LiteralPath $entryPath)) {
    throw "Self-test daemon entry is missing: $entryPath"
  }

  $env:MIMO_BRIDGE_DATA_DIR = $dataRoot
  $env:MIMO_BRIDGE_CONFIG = $configPath
  $env:MIMO_BRIDGE_NODE_PATH = $nodePath
  $process = Start-Process -FilePath $nodePath -ArgumentList @($entryPath) -WorkingDirectory $appRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
  try {
    $deadline = (Get-Date).AddSeconds(60)
    do {
      if (Test-HttpHealth -Port $Port -TimeoutSec 2) {
        break
      }
      Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    if (-not (Test-HttpHealth -Port $Port -TimeoutSec 2)) {
      $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue } else { "" }
      $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue } else { "" }
      throw "Self-test daemon did not pass /api/health on port $Port. stdout=$stdout stderr=$stderr"
    }

    $ui = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/" -f $Port) -TimeoutSec 5
    $contentType = [string]$ui.Headers["Content-Type"]
    $content = [string]$ui.Content
    if ($ui.StatusCode -ne 200 -or ($contentType -notmatch "text/html" -and $content -notmatch "<!doctype html|<html")) {
      throw "Self-test Admin UI was not served as HTML."
    }
  } finally {
    if ($process -and -not $process.HasExited) {
      try {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(10000) | Out-Null
      } catch {
        Write-SetupLog "Self-test daemon stop failed: $($_.Exception.Message)"
      }
    }
  }
}

function Stop-DaemonIfInstalled {
  param([Parameter(Mandatory = $true)]$Paths)
  Assert-InstalledDaemonStopped -Paths $Paths
}

function Write-InstalledLaunchers {
  param([Parameter(Mandatory = $true)]$Paths)
  New-Item -ItemType Directory -Force -Path $Paths.DataRoot | Out-Null
  $dataRoot = [string]$Paths.DataRoot
  $configPath = [string]$Paths.ConfigPath
  $launcherLines = @(
    "@echo off",
    'set "ROOT=%~dp0"',
    'set "MIMO_BRIDGE_NODE_PATH=%ROOT%node\node.exe"',
    ('set "MIMO_BRIDGE_DATA_DIR={0}"' -f $dataRoot),
    ('set "MIMO_BRIDGE_CONFIG={0}"' -f $configPath),
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%app\apps\local-daemon\launcher.ps1" %*'
  )
  Write-Utf8NoBom -Path $Paths.LauncherCmd -Content (($launcherLines -join [Environment]::NewLine) + [Environment]::NewLine)
  Write-Utf8NoBom -Path $Paths.StartCmd -Content ("@echo off" + [Environment]::NewLine + 'call "%~dp0MiMo Bridge Launcher.cmd" start -Open' + [Environment]::NewLine)
  Write-Utf8NoBom -Path $Paths.StopCmd -Content ("@echo off" + [Environment]::NewLine + 'call "%~dp0MiMo Bridge Launcher.cmd" stop' + [Environment]::NewLine)
  Write-Utf8NoBom -Path $Paths.ConfigureCmd -Content ("@echo off" + [Environment]::NewLine + 'call "%~dp0MiMo Bridge Launcher.cmd" configure' + [Environment]::NewLine)
}

function New-Shortcut {
  param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [string]$Arguments = "",
    [string]$WorkingDirectory = "",
    [string]$Description = "MiMo Bridge"
  )
  New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($ShortcutPath)) | Out-Null
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.Save()
}

function Register-Autostart {
  param([Parameter(Mandatory = $true)][string]$StartCmd)
  $argument = '/c "' + $StartCmd + '"'
  $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $argument
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Start MiMo Bridge for the current user at logon" -Force | Out-Null
}

function Unregister-Autostart {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
}

function Register-UninstallEntry {
  param([Parameter(Mandatory = $true)]$Paths)
  $keyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
  New-Item -Path $keyPath -Force | Out-Null
  $uninstallCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $Paths.MaintenanceScript + '" -Uninstall'
  $quietCommand = $uninstallCommand + " -Quiet"
  Set-ItemProperty -Path $keyPath -Name DisplayName -Value $AppName
  Set-ItemProperty -Path $keyPath -Name DisplayVersion -Value $AppVersion
  Set-ItemProperty -Path $keyPath -Name Publisher -Value "MiMo Bridge"
  Set-ItemProperty -Path $keyPath -Name InstallLocation -Value $Paths.InstallRoot
  Set-ItemProperty -Path $keyPath -Name UninstallString -Value $uninstallCommand
  Set-ItemProperty -Path $keyPath -Name QuietUninstallString -Value $quietCommand
  New-ItemProperty -Path $keyPath -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $keyPath -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
}

function Remove-UninstallEntry {
  $keyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
  if (Test-Path -LiteralPath $keyPath) {
    Remove-Item -LiteralPath $keyPath -Recurse -Force
  }
}

function Schedule-DirectoryRemoval {
  param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [string]$DataRoot
  )
  $localAppData = Get-LocalAppData
  Assert-UnderPath -Path $InstallRoot -Parent $localAppData
  if ($DataRoot) {
    Assert-UnderPath -Path $DataRoot -Parent $localAppData
  }
  $scriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-uninstall-" + [guid]::NewGuid().ToString("N") + ".cmd")
  $lines = @("@echo off", "ping 127.0.0.1 -n 3 > nul", 'rmdir /s /q "' + $InstallRoot + '"')
  if ($DataRoot) {
    $lines += 'rmdir /s /q "' + $DataRoot + '"'
  }
  $lines += 'del "%~f0"'
  [System.IO.File]::WriteAllText($scriptPath, (($lines -join [Environment]::NewLine) + [Environment]::NewLine), [System.Text.Encoding]::ASCII)
  Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $scriptPath) -WindowStyle Hidden | Out-Null
}

function Install-App {
  Assert-SupportedWindows
  $paths = Get-Paths
  $createDesktop = -not $NoDesktopShortcut
  $enableAutostart = $Autostart
  if (-not $Quiet -and [Environment]::UserInteractive) {
    $createDesktop = Read-YesNo -Prompt "Create desktop shortcut?" -Default $true
    $enableAutostart = Read-YesNo -Prompt "Start MiMo Bridge when Windows logs in?" -Default $false
  }
  if ($NoDesktopShortcut) {
    $createDesktop = $false
  }

  Write-Host "MiMo Bridge Setup - Windows 10/11 x64"
  Write-Host "Install directory: $($paths.InstallRoot)"
  Write-Host "User data directory: $($paths.DataRoot)"

  New-Item -ItemType Directory -Force -Path $paths.InstallRoot, $paths.DataRoot | Out-Null
  Assert-InstalledDaemonStopped -Paths $paths

  $payloadZip = Join-Path $PSScriptRoot "MiMoBridge-payload.zip"
  if (-not (Test-Path -LiteralPath $payloadZip)) {
    throw "Missing installer payload: $payloadZip"
  }
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-install-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  try {
    Expand-Archive -LiteralPath $payloadZip -DestinationPath $tempRoot -Force
    $payloadRoot = Join-Path $tempRoot "MiMoBridge"
    if (-not (Test-Path -LiteralPath $payloadRoot)) {
      $payloadRoot = $tempRoot
    }
    Install-StagedPayload -Paths $paths -StageRoot $payloadRoot
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-InstalledLaunchers -Paths $paths
  Copy-Item -LiteralPath $PSCommandPath -Destination $paths.MaintenanceScript -Force
  $readme = @(
    "# MiMo Bridge Installed Mode",
    "",
    "Target: Windows 10/11 x64.",
    "User data is stored under LOCALAPPDATA\MiMoBridge.",
    "MiMo credentials, task logs, active tasks, and Worktrees are not bundled.",
    "MiMo Code must be installed and logged in separately on this computer."
  ) -join [Environment]::NewLine
  Write-Utf8NoBom -Path (Join-Path $paths.InstallRoot "README_INSTALLED.md") -Content ($readme + [Environment]::NewLine)

  New-Shortcut -ShortcutPath (Join-Path $paths.StartMenuDir "Start MiMo Bridge.lnk") -TargetPath $paths.StartCmd -WorkingDirectory $paths.InstallRoot -Description "Start MiMo Bridge"
  New-Shortcut -ShortcutPath (Join-Path $paths.StartMenuDir "Configure MiMo Bridge.lnk") -TargetPath $paths.ConfigureCmd -WorkingDirectory $paths.InstallRoot -Description "Configure MiMo Bridge"
  New-Shortcut -ShortcutPath (Join-Path $paths.StartMenuDir "Stop MiMo Bridge.lnk") -TargetPath $paths.StopCmd -WorkingDirectory $paths.InstallRoot -Description "Stop MiMo Bridge"
  New-Shortcut -ShortcutPath (Join-Path $paths.StartMenuDir "Uninstall MiMo Bridge.lnk") -TargetPath "powershell.exe" -Arguments ('-NoProfile -ExecutionPolicy Bypass -File "' + $paths.MaintenanceScript + '" -Uninstall') -WorkingDirectory $paths.InstallRoot -Description "Uninstall MiMo Bridge"
  if ($createDesktop) {
    New-Shortcut -ShortcutPath $paths.DesktopShortcut -TargetPath $paths.StartCmd -WorkingDirectory $paths.InstallRoot -Description "Start MiMo Bridge"
  } elseif (Test-Path -LiteralPath $paths.DesktopShortcut) {
    Remove-Item -LiteralPath $paths.DesktopShortcut -Force
  }

  if ($enableAutostart) {
    Register-Autostart -StartCmd $paths.StartCmd
  } else {
    Unregister-Autostart
  }

  Register-UninstallEntry -Paths $paths
  Write-Host "MiMo Bridge installed."
}

function Uninstall-App {
  $paths = Get-Paths
  if (-not $Quiet) {
    $confirmed = Read-YesNo -Prompt "Uninstall MiMo Bridge application files?" -Default $true
    if (-not $confirmed) {
      Write-Host "Uninstall cancelled."
      return
    }
  }
  Stop-DaemonIfInstalled -Paths $paths
  Unregister-Autostart
  if (Test-Path -LiteralPath $paths.DesktopShortcut) {
    Remove-Item -LiteralPath $paths.DesktopShortcut -Force
  }
  if (Test-Path -LiteralPath $paths.StartMenuDir) {
    Remove-Item -LiteralPath $paths.StartMenuDir -Recurse -Force
  }
  Remove-UninstallEntry
  $dataToRemove = if ($DeleteUserData) { $paths.DataRoot } else { $null }
  Schedule-DirectoryRemoval -InstallRoot $paths.InstallRoot -DataRoot $dataToRemove
  if ($DeleteUserData) {
    Write-Host "MiMo Bridge uninstall scheduled. User data will also be removed."
  } else {
    Write-Host "MiMo Bridge uninstall scheduled. User data is preserved."
  }
}

if ($SelfTest) {
  Test-InstallerPayload
} elseif ($Uninstall) {
  Uninstall-App
} else {
  Install-App
}
