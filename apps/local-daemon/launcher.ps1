param(
  [Parameter(Position = 0)]
  [ValidateSet("menu", "start", "stop", "restart", "status", "logs", "open", "configure", "shortcut", "autostart", "mcp-info", "help")]
  [string]$Command = "menu",

  [Parameter(Position = 1)]
  [string]$SubCommand = "",

  [switch]$Open,
  [switch]$Json,
  [int]$Lines = 80
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$cliPath = Join-Path $repoRoot "apps\local-daemon\dist\apps\local-daemon\src\launcher-cli.js"

if (-not (Test-Path -LiteralPath $cliPath)) {
  Write-Error "找不到 launcher 构建产物: $cliPath。请先运行 apps\local-daemon\start-local.ps1 完成构建。"
  exit 1
}

$nodePath = $env:MIMO_BRIDGE_NODE_PATH
if (-not $nodePath) {
  $nodePath = "node"
}

$argsList = @($Command)
if ($Command -eq "autostart" -and $SubCommand) {
  $argsList += $SubCommand
}
if ($Open) {
  $argsList += "--open"
}
if ($Json) {
  $argsList += "--json"
}
if ($Command -eq "logs") {
  $argsList += "--lines"
  $argsList += [string]$Lines
}

Set-Location -LiteralPath $repoRoot
& $nodePath "$cliPath" @argsList
exit $LASTEXITCODE
