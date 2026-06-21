param(
  [switch]$SkipBuild,
  [switch]$SkipZip
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$artifactsDir = Join-Path $repoRoot "artifacts"
$portableDir = Join-Path $artifactsDir "portable"
$packageRoot = Join-Path $portableDir "MiMoBridge"
$appRoot = Join-Path $packageRoot "app"
$zipPath = Join-Path $artifactsDir "MiMoBridge-portable-win10-win11-x64.zip"

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $FilePath $($Arguments -join ' ')"
  }
}

function Copy-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing directory: $Source"
  }
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed from $Source to $Destination with exit code $LASTEXITCODE"
  }
  $global:LASTEXITCODE = 0
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Resolve-NodeExe {
  if ($env:MIMO_BRIDGE_NODE_PATH -and (Test-Path -LiteralPath $env:MIMO_BRIDGE_NODE_PATH)) {
    return (Resolve-Path -LiteralPath $env:MIMO_BRIDGE_NODE_PATH).Path
  }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "node.exe was not found. Install Node or set MIMO_BRIDGE_NODE_PATH."
  }
  return $command.Source
}

if (-not $SkipBuild) {
  Push-Location -LiteralPath $repoRoot
  try {
    Invoke-CheckedCommand npm.cmd run build
    Push-Location -LiteralPath (Join-Path $repoRoot "apps\admin-ui")
    try { Invoke-CheckedCommand npm.cmd run build } finally { Pop-Location }
    Push-Location -LiteralPath (Join-Path $repoRoot "apps\local-daemon")
    try { Invoke-CheckedCommand npm.cmd run build } finally { Pop-Location }
  } finally {
    Pop-Location
  }
}

$nodeExe = Resolve-NodeExe

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $packageRoot, $appRoot, (Join-Path $packageRoot "node"), (Join-Path $packageRoot "data") | Out-Null

Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $packageRoot "node\node.exe") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "package.json") -Destination (Join-Path $appRoot "package.json") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "package-lock.json") -Destination (Join-Path $appRoot "package-lock.json") -Force

Copy-Directory -Source (Join-Path $repoRoot "node_modules") -Destination (Join-Path $appRoot "node_modules")

Push-Location -LiteralPath $appRoot
try {
  Invoke-CheckedCommand npm.cmd prune --omit=dev --no-audit --no-fund
} finally {
  Pop-Location
}

Copy-Directory -Source (Join-Path $repoRoot "apps\local-daemon\dist") -Destination (Join-Path $appRoot "apps\local-daemon\dist")
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\local-daemon\launcher.ps1") -Destination (Join-Path $appRoot "apps\local-daemon\launcher.ps1") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\local-daemon\start-production.ps1") -Destination (Join-Path $appRoot "apps\local-daemon\start-production.ps1") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\local-daemon\package.json") -Destination (Join-Path $appRoot "apps\local-daemon\package.json") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\local-daemon\README.md") -Destination (Join-Path $appRoot "apps\local-daemon\README.md") -Force
Copy-Directory -Source (Join-Path $repoRoot "apps\admin-ui\dist") -Destination (Join-Path $appRoot "apps\admin-ui\dist")

$launcherCmd = @'
@echo off
set "ROOT=%~dp0"
set "MIMO_BRIDGE_NODE_PATH=%ROOT%node\node.exe"
set "MIMO_BRIDGE_DATA_DIR=%ROOT%data"
set "MIMO_BRIDGE_CONFIG=%ROOT%data\config.json"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%app\apps\local-daemon\launcher.ps1" %*
'@
Write-Utf8NoBom -Path (Join-Path $packageRoot "MiMo Bridge Launcher.cmd") -Content $launcherCmd

$startCmd = @'
@echo off
call "%~dp0MiMo Bridge Launcher.cmd" start -Open
'@
Write-Utf8NoBom -Path (Join-Path $packageRoot "Start MiMo Bridge.cmd") -Content $startCmd

$stopCmd = @'
@echo off
call "%~dp0MiMo Bridge Launcher.cmd" stop
'@
Write-Utf8NoBom -Path (Join-Path $packageRoot "Stop MiMo Bridge.cmd") -Content $stopCmd

$configureCmd = @'
@echo off
call "%~dp0MiMo Bridge Launcher.cmd" configure
'@
Write-Utf8NoBom -Path (Join-Path $packageRoot "Configure MiMo Bridge.cmd") -Content $configureCmd

$readme = @'
# MiMo Bridge Portable - Windows 10/11 x64

This is a portable application package for MiMo Bridge MCP.

## How to use

1. Install and log in to MiMo Code on this computer first. This package does not include MiMo credentials.
2. Run `Configure MiMo Bridge.cmd` once and set:
   - MiMo Node path
   - MiMo CLI entry path
   - allowed project roots
   - runtime directory
   - port
3. Run `Start MiMo Bridge.cmd` to start the local daemon and open the admin UI.
4. Use `MiMo Bridge Launcher.cmd` for the interactive menu.
5. Use `Stop MiMo Bridge.cmd` before moving or deleting the folder.

## Data policy

The package includes built application files, production dependencies, and a bundled Node runtime.

It does not include MiMo login state, MiMo credentials, existing tasks, runtime logs, or Git Worktrees.

Portable data is stored under this package's `data` directory by default.

## Codex MCP endpoint

Default endpoint after startup:

`http://127.0.0.1:3210/mcp`

The local port is still used internally so Codex and the admin UI can share one daemon. The user does not need to start a separate local proxy manually.
'@
Write-Utf8NoBom -Path (Join-Path $packageRoot "README_PORTABLE.md") -Content $readme

$commit = "unknown"
try {
  Push-Location -LiteralPath $repoRoot
  $commit = (& git rev-parse --short HEAD).Trim()
} catch {
  $commit = "unknown"
} finally {
  Pop-Location
}

$manifest = [ordered]@{
  name = "MiMo Bridge Portable"
  target = "windows-10-11-x64"
  source_commit = $commit
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  includes_node = $true
  includes_mimo_credentials = $false
  includes_tasks = $false
  includes_worktrees = $false
  mcp_endpoint = "http://127.0.0.1:3210/mcp"
}
Write-Utf8NoBom -Path (Join-Path $packageRoot "package-manifest.json") -Content (($manifest | ConvertTo-Json -Depth 4) + "`n")

if (-not $SkipZip) {
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -Force
}

Write-Host "Portable package directory: $packageRoot"
if (-not $SkipZip) {
  Write-Host "Portable package zip: $zipPath"
}
