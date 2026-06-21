param(
  [switch]$SkipPortableBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$artifactsDir = Join-Path $repoRoot "artifacts"
$installerStageDir = Join-Path $artifactsDir "installer"
$payloadDir = Join-Path $installerStageDir "payload"
$portableRoot = Join-Path $artifactsDir "portable\MiMoBridge"
$payloadZip = Join-Path $payloadDir "MiMoBridge-payload.zip"
$installerExe = Join-Path $artifactsDir "MiMoBridgeSetup-win10-win11-x64.exe"
$installerScript = Join-Path $repoRoot "scripts\installer\install.ps1"
$stubSource = Join-Path $repoRoot "apps\windows-installer\setup-stub.c"
$stubWorkRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-installer-stub-" + [guid]::NewGuid().ToString("N"))
$stubWorkDir = Join-Path $stubWorkRoot "src"
$tempInstallerExe = Join-Path $stubWorkRoot "MiMoBridgeSetup-win10-win11-x64.exe"
$resourceScript = Join-Path $stubWorkRoot "resources.rc"
$resourceObject = Join-Path $stubWorkRoot "resources.o"

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

function Assert-UnderPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  if (-not ($resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Refusing to modify path outside expected parent: $resolvedPath"
  }
}

function Reset-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  Assert-UnderPath -Path $Path -Parent $Parent
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-TextFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content,
    [switch]$DefaultEncoding
  )
  $encoding = if ($DefaultEncoding) { [System.Text.Encoding]::Default } else { New-Object System.Text.UTF8Encoding($false) }
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

New-Item -ItemType Directory -Force -Path $artifactsDir, $installerStageDir | Out-Null

if (-not $SkipPortableBuild) {
  Invoke-CheckedCommand powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-portable.ps1")
}

if (-not (Test-Path -LiteralPath $portableRoot)) {
  throw "Portable package root not found: $portableRoot"
}
if (-not (Test-Path -LiteralPath $installerScript)) {
  throw "Installer script not found: $installerScript"
}
if (-not (Test-Path -LiteralPath $stubSource)) {
  throw "Installer stub source not found: $stubSource"
}

Reset-Directory -Path $payloadDir -Parent $artifactsDir
New-Item -ItemType Directory -Force -Path $stubWorkDir | Out-Null

if (Test-Path -LiteralPath $payloadZip) {
  Remove-Item -LiteralPath $payloadZip -Force
}
if (Test-Path -LiteralPath $installerExe) {
  Remove-Item -LiteralPath $installerExe -Force
}

$payloadItems = Get-ChildItem -LiteralPath $portableRoot -Force
if ($payloadItems.Count -eq 0) {
  throw "Portable package root is empty: $portableRoot"
}
Compress-Archive -LiteralPath $payloadItems.FullName -DestinationPath $payloadZip -Force

Copy-Item -LiteralPath $payloadZip -Destination (Join-Path $stubWorkDir "MiMoBridge-payload.zip") -Force
Copy-Item -LiteralPath $installerScript -Destination (Join-Path $stubWorkDir "install.ps1") -Force
Copy-Item -LiteralPath $stubSource -Destination (Join-Path $stubWorkDir "setup-stub.c") -Force

$payloadResourcePath = (Join-Path $stubWorkDir "MiMoBridge-payload.zip").Replace("\", "\\")
$installResourcePath = (Join-Path $stubWorkDir "install.ps1").Replace("\", "\\")
$rc = @(
  "#define IDR_INSTALL_PS1 101",
  "#define IDR_PAYLOAD_ZIP 102",
  "IDR_INSTALL_PS1 RCDATA ""$installResourcePath""",
  "IDR_PAYLOAD_ZIP RCDATA ""$payloadResourcePath"""
) -join [Environment]::NewLine
Write-TextFile -Path $resourceScript -Content ($rc + [Environment]::NewLine)

$gccCommand = Get-Command gcc.exe -ErrorAction Stop
$preprocessorPath = Join-Path $stubWorkRoot "windres-cpp.cmd"
$preprocessorContent = "@echo off" + [Environment]::NewLine + """" + $gccCommand.Source + """ -E -xc -DRC_INVOKED %*" + [Environment]::NewLine
Write-TextFile -Path $preprocessorPath -Content $preprocessorContent

$windresArgs = @("--preprocessor=$preprocessorPath", $resourceScript, "-O", "coff", "-o", $resourceObject)
Invoke-CheckedCommand -FilePath windres.exe -Arguments $windresArgs
$gccArgs = @("-municode", "-O2", "-s", (Join-Path $stubWorkDir "setup-stub.c"), $resourceObject, "-o", $tempInstallerExe, "-lshell32")
Invoke-CheckedCommand -FilePath gcc.exe -Arguments $gccArgs

if (-not (Test-Path -LiteralPath $tempInstallerExe)) {
  throw "Installer exe not found after stub build: $tempInstallerExe"
}
Copy-Item -LiteralPath $tempInstallerExe -Destination $installerExe -Force

Remove-Item -LiteralPath $stubWorkRoot -Recurse -Force -ErrorAction SilentlyContinue

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
  name = "MiMo Bridge Installer"
  target = "windows-10-11-x64"
  source_commit = $commit
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  output = $installerExe
  builder = "mingw-resource-stub"
  includes_node = $true
  includes_mimo_credentials = $false
  includes_tasks = $false
  includes_worktrees = $false
}
$manifestPath = Join-Path $installerStageDir "installer-manifest.json"
Write-TextFile -Path $manifestPath -Content (($manifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine)

Write-Host "Installer exe: $installerExe"
Write-Host "Installer manifest: $manifestPath"
