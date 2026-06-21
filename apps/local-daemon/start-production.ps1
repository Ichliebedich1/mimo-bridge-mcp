$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")

Set-Location -LiteralPath $repoRoot

$nodePath = $env:MIMO_BRIDGE_NODE_PATH
if (-not $nodePath) {
  $nodePath = "node"
}

$entryPath = Join-Path $repoRoot "apps\local-daemon\dist\apps\local-daemon\src\index.js"

if (-not (Test-Path -LiteralPath $entryPath)) {
  Write-Error "Build artifact not found: $entryPath. Run start-local.ps1 to build first."
  exit 1
}

Write-Host "Starting MiMo Bridge Local Daemon..."
& $nodePath "$entryPath"
