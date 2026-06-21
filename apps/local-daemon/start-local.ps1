$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")

Set-Location -LiteralPath $repoRoot

Write-Host "Building admin UI..."
Push-Location -LiteralPath (Join-Path $repoRoot "apps\admin-ui")
npm.cmd run build
Pop-Location

Write-Host "Building local daemon..."
Push-Location -LiteralPath (Join-Path $repoRoot "apps\local-daemon")
npm.cmd run build
Pop-Location

$nodePath = $env:MIMO_BRIDGE_NODE_PATH
if (-not $nodePath) {
  $nodePath = "node"
}

Write-Host "Starting MiMo Bridge Local Daemon..."
$launcherPath = Join-Path $repoRoot "apps\local-daemon\dist\apps\local-daemon\src\launcher-cli.js"
& $nodePath "$launcherPath" start --open
exit $LASTEXITCODE
