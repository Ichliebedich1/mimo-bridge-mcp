param(
  [string]$DestinationRoot
)

$ErrorActionPreference = "Stop"
$SkillName = "use-mimo-bridge-mcp"

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $fullPath = Get-FullPath -Path $Path
  $fullParent = Get-FullPath -Path $Parent
  $prefix = $fullParent + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside destination root: $fullPath"
  }
}

function Find-SourceSkill {
  $candidates = @(
    (Join-Path $PSScriptRoot "codex-skill\$SkillName"),
    (Join-Path (Split-Path -Parent $PSScriptRoot) "skills\$SkillName")
  )
  foreach ($candidate in $candidates) {
    $skillFile = Join-Path $candidate "SKILL.md"
    if (Test-Path -LiteralPath $skillFile) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "Bundled Codex skill not found."
}

function Test-SkillPayload {
  param([Parameter(Mandatory = $true)][string]$Path)
  $skillFile = Join-Path $Path "SKILL.md"
  $playbook = Join-Path $Path "references\playbook.md"
  $metadata = Join-Path $Path "agents\openai.yaml"
  foreach ($required in @($skillFile, $playbook, $metadata)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Skill payload missing required file: $required"
    }
  }
  $header = Get-Content -LiteralPath $skillFile -TotalCount 4
  if (($header -join "`n") -notmatch "(?m)^name:\s+use-mimo-bridge-mcp$") {
    throw "Skill payload has an invalid name."
  }
}

$sourceSkill = Find-SourceSkill
Test-SkillPayload -Path $sourceSkill

if (-not $DestinationRoot) {
  if ($env:CODEX_HOME) {
    $DestinationRoot = Join-Path $env:CODEX_HOME "skills"
  } else {
    $DestinationRoot = Join-Path $env:USERPROFILE ".codex\skills"
  }
}

$destinationRootFull = Get-FullPath -Path $DestinationRoot
$destinationSkill = Join-Path $destinationRootFull $SkillName
$stageSkill = Join-Path $destinationRootFull ("." + $SkillName + "-stage-" + [guid]::NewGuid().ToString("N"))
$backupParent = Join-Path $destinationRootFull ".mimo-bridge-skill-backups"
$backupSkill = Join-Path $backupParent ($SkillName + "-" + (Get-Date -Format "yyyyMMdd-HHmmssfff") + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8))

Assert-ChildPath -Path $destinationSkill -Parent $destinationRootFull
Assert-ChildPath -Path $stageSkill -Parent $destinationRootFull
Assert-ChildPath -Path $backupParent -Parent $destinationRootFull
Assert-ChildPath -Path $backupSkill -Parent $destinationRootFull

New-Item -ItemType Directory -Force -Path $destinationRootFull | Out-Null
$movedExisting = $false
try {
  Copy-Item -LiteralPath $sourceSkill -Destination $stageSkill -Recurse -Force
  Test-SkillPayload -Path $stageSkill

  if (Test-Path -LiteralPath $destinationSkill) {
    New-Item -ItemType Directory -Force -Path $backupParent | Out-Null
    Move-Item -LiteralPath $destinationSkill -Destination $backupSkill
    $movedExisting = $true
  }

  Move-Item -LiteralPath $stageSkill -Destination $destinationSkill
} catch {
  if ((-not (Test-Path -LiteralPath $destinationSkill)) -and $movedExisting -and (Test-Path -LiteralPath $backupSkill)) {
    Move-Item -LiteralPath $backupSkill -Destination $destinationSkill
  }
  throw
} finally {
  if (Test-Path -LiteralPath $stageSkill) {
    Remove-Item -LiteralPath $stageSkill -Recurse -Force
  }
}

Write-Host "MiMo Bridge Codex skill installed: $destinationSkill"
if ($movedExisting) {
  Write-Host "Previous skill backup: $backupSkill"
}
Write-Host "Open a new Codex session if the skill list is already cached."
