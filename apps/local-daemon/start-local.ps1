$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")

$env:MIMO_NODE_PATH = "D:\AI\Mimo2 Codex\.tools\node-v22.22.3-win-x64\node.exe"
$env:MIMO_ENTRY_PATH = "D:\AI\Mimo2 Codex\.tools\node-v22.22.3-win-x64\node_modules\@mimo-ai\cli\bin\mimo"
$env:MIMO_ALLOWED_ROOTS = "C:\Users\86172\Desktop\MiMo Code project\Agent 协作项目"
$env:MIMO_RUNTIME_DIR = Join-Path $repoRoot "runtime"
$env:MIMO_DAEMON_PORT = "3210"

Set-Location -LiteralPath $repoRoot

Write-Host "Building admin UI..."
Push-Location -LiteralPath (Join-Path $repoRoot "apps\admin-ui")
npm.cmd run build
Pop-Location

Write-Host "Building local daemon..."
Push-Location -LiteralPath (Join-Path $repoRoot "apps\local-daemon")
npm.cmd run build
Pop-Location

Write-Host "Starting MiMo Bridge Local Daemon on http://127.0.0.1:3210/"
$entryPath = Join-Path $repoRoot "apps\local-daemon\dist\apps\local-daemon\src\index.js"
& $env:MIMO_NODE_PATH "$entryPath"
