param(
  [switch]$Quiet,
  [switch]$NoDesktopShortcut,
  [switch]$Autostart,
  [switch]$Uninstall,
  [switch]$DeleteUserData,
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$AppName = "MiMo Bridge"
$AppId = "MiMoBridge"
$AppVersion = "0.1.0"
$TaskName = "MiMoBridge-Launcher"

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

function Stop-DaemonIfInstalled {
  param([Parameter(Mandatory = $true)]$Paths)
  if (Test-Path -LiteralPath $Paths.StopCmd) {
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $Paths.StopCmd) -WorkingDirectory $Paths.InstallRoot -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(15000)) {
      try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
}

function Write-InstalledLaunchers {
  param([Parameter(Mandatory = $true)]$Paths)
  New-Item -ItemType Directory -Force -Path $Paths.DataRoot | Out-Null
  $launcherLines = @(
    "@echo off",
    'set "ROOT=%~dp0"',
    'set "MIMO_BRIDGE_NODE_PATH=%ROOT%node\node.exe"',
    'set "MIMO_BRIDGE_DATA_DIR=' + $Paths.DataRoot + '"',
    'set "MIMO_BRIDGE_CONFIG=' + $Paths.ConfigPath + '"',
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
  if (-not $Quiet) {
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
  Stop-DaemonIfInstalled -Paths $paths

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
    Remove-KnownChild -Parent $paths.InstallRoot -Name "app"
    Remove-KnownChild -Parent $paths.InstallRoot -Name "node"
    Remove-KnownChild -Parent $paths.InstallRoot -Name "data"
    Get-ChildItem -LiteralPath $paths.InstallRoot -Filter "*.cmd" -Force -ErrorAction SilentlyContinue | Remove-Item -Force
    Copy-Directory -Source $payloadRoot -Destination $paths.InstallRoot -SkipTopLevelData $true
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

if ($Uninstall) {
  Uninstall-App
} else {
  Install-App
}
