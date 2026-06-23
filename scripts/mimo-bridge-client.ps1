param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientScript = Join-Path $scriptDir "mimo-bridge-client.mjs"
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if (-not $nodeCommand) {
    [Console]::Error.WriteLine("ERROR: node was not found on PATH. Install Node or use the portable launcher environment.")
    exit 1
}

$tempJson = $null
try {
    $forwardArgs = @($clientScript) + $Arguments

    if ($MyInvocation.ExpectingInput -and -not ($Arguments -contains "--json")) {
        $stdinText = [Console]::In.ReadToEnd()
        if ($stdinText.Length -gt 0) {
            $tempJson = Join-Path ([System.IO.Path]::GetTempPath()) ("mimo-bridge-client-" + [System.Guid]::NewGuid().ToString("N") + ".json")
            [System.IO.File]::WriteAllText($tempJson, $stdinText, [System.Text.UTF8Encoding]::new($false))
            $forwardArgs += @("--json", $tempJson)
        }
    }

    & $nodeCommand.Source @forwardArgs
    exit $LASTEXITCODE
}
finally {
    if ($tempJson -and (Test-Path -LiteralPath $tempJson)) {
        Remove-Item -LiteralPath $tempJson -Force -ErrorAction SilentlyContinue
    }
}
