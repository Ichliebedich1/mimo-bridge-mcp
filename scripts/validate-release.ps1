param(
  [switch]$SkipPackageBuild,
  [switch]$SkipSelfTest
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$artifactsDir = Join-Path $repoRoot "artifacts"
$portableZip = Join-Path $artifactsDir "MiMoBridge-portable-win10-win11-x64.zip"
$installerExe = Join-Path $artifactsDir "MiMoBridgeSetup-win10-win11-x64.exe"
$portableRoot = Join-Path $artifactsDir "portable\MiMoBridge"
$portableManifestPath = Join-Path $portableRoot "package-manifest.json"
$installerManifestPath = Join-Path $artifactsDir "installer\installer-manifest.json"
$reportPath = Join-Path $artifactsDir "release-validation.json"

$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$Passed,
    [string]$Detail = ""
  )
  $script:checks.Add([ordered]@{
    name = $Name
    passed = $Passed
    detail = $Detail
  })
  if (-not $Passed) {
    throw "Release validation failed: $Name $Detail"
  }
}

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

function Read-JsonFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing JSON file: $Path"
  }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Test-Artifact {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Path
  )
  $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
  Add-Check -Name "$Name exists" -Passed ($null -ne $item) -Detail $Path
  Add-Check -Name "$Name is non-empty" -Passed ($item.Length -gt 0) -Detail "$($item.Length) bytes"
}

function Test-ManifestBooleans {
  param(
    [Parameter(Mandatory = $true)]$Manifest,
    [Parameter(Mandatory = $true)][string]$Name
  )
  Add-Check -Name "$Name target" -Passed ($Manifest.target -eq "windows-10-11-x64") -Detail "$($Manifest.target)"
  Add-Check -Name "$Name includes node" -Passed ([bool]$Manifest.includes_node) -Detail "$($Manifest.includes_node)"
  Add-Check -Name "$Name excludes MiMo credentials" -Passed (-not [bool]$Manifest.includes_mimo_credentials) -Detail "$($Manifest.includes_mimo_credentials)"
  Add-Check -Name "$Name excludes tasks" -Passed (-not [bool]$Manifest.includes_tasks) -Detail "$($Manifest.includes_tasks)"
  Add-Check -Name "$Name excludes worktrees" -Passed (-not [bool]$Manifest.includes_worktrees) -Detail "$($Manifest.includes_worktrees)"
}

function Test-PortablePayload {
  Add-Check -Name "portable root exists" -Passed (Test-Path -LiteralPath $portableRoot) -Detail $portableRoot
  $required = @(
    "node\node.exe",
    "app\apps\local-daemon\dist\apps\local-daemon\src\index.js",
    "app\apps\local-daemon\dist\apps\local-daemon\src\launcher-cli.js",
    "app\apps\admin-ui\dist\index.html",
    "MiMo Bridge Launcher.cmd",
    "Start MiMo Bridge.cmd",
    "Stop MiMo Bridge.cmd",
    "Configure MiMo Bridge.cmd"
  )
  foreach ($relativePath in $required) {
    Add-Check -Name "portable required file $relativePath" -Passed (Test-Path -LiteralPath (Join-Path $portableRoot $relativePath))
  }

  $forbidden = @("runtime", "worktrees", "tasks", ".git", "data\config.json", "data\tasks", "data\launcher-state.json", "data\daemon.out.log", "data\daemon.err.log")
  foreach ($relativePath in $forbidden) {
    Add-Check -Name "portable excludes $relativePath" -Passed (-not (Test-Path -LiteralPath (Join-Path $portableRoot $relativePath)))
  }

  $dataDir = Join-Path $portableRoot "data"
  if (Test-Path -LiteralPath $dataDir) {
    $hasData = $null -ne (Get-ChildItem -LiteralPath $dataDir -Force -Recurse | Select-Object -First 1)
    Add-Check -Name "portable data directory empty" -Passed (-not $hasData)
  }

  $sensitive = Get-ChildItem -LiteralPath $portableRoot -Force -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @("auth.json", "mimocode.jsonc") } |
    Select-Object -First 1
  Add-Check -Name "portable excludes known credential files" -Passed ($null -eq $sensitive) -Detail "$($sensitive.FullName)"
}

if (-not $SkipPackageBuild) {
  Push-Location -LiteralPath $repoRoot
  try {
    Invoke-CheckedCommand npm.cmd run package:installer
  } finally {
    Pop-Location
  }
}

Test-Artifact -Name "portable zip" -Path $portableZip
Test-Artifact -Name "installer exe" -Path $installerExe

$portableManifest = Read-JsonFile $portableManifestPath
$installerManifest = Read-JsonFile $installerManifestPath
Test-ManifestBooleans -Manifest $portableManifest -Name "portable manifest"
Test-ManifestBooleans -Manifest $installerManifest -Name "installer manifest"
Add-Check -Name "installer builder" -Passed ($installerManifest.builder -eq "mingw-resource-stub") -Detail "$($installerManifest.builder)"

Test-PortablePayload

if (-not $SkipSelfTest) {
  & $installerExe -SelfTest
  Add-Check -Name "installer self-test" -Passed ($LASTEXITCODE -eq 0) -Detail "exit=$LASTEXITCODE"
}

$report = [ordered]@{
  ok = $true
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  target = "windows-10-11-x64"
  portable_zip = $portableZip
  installer_exe = $installerExe
  checks = $checks
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($reportPath, (($report | ConvertTo-Json -Depth 6) + [Environment]::NewLine), $utf8NoBom)
Write-Host "Release validation passed: $reportPath"
