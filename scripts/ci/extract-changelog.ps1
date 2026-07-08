$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RequiredFile {
  param(
    [Parameter(Mandatory = $false)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Fallback,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { $Fallback } else { $Value }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "$Name 不存在或不是文件: $candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Get-ChangelogSection {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Lines,
    [Parameter(Mandatory = $true)][string]$Version
  )

  $escapedVersion = [Regex]::Escape($Version.TrimStart("v"))
  $headingPattern = "^\s*##\s+\[?v?$escapedVersion\]?(?:\s+-\s+.*)?\s*$"
  $nextHeadingPattern = "^\s*##\s+"
  $startIndex = -1

  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match $headingPattern) {
      $startIndex = $index
      break
    }
  }

  if ($startIndex -lt 0) {
    throw "未在 CHANGELOG 中找到版本 $Version 的更新记录。"
  }

  $endIndex = $Lines.Count
  for ($index = $startIndex + 1; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match $nextHeadingPattern) {
      $endIndex = $index
      break
    }
  }

  $section = $Lines[$startIndex..($endIndex - 1)]
  while ($section.Count -gt 0 -and [string]::IsNullOrWhiteSpace($section[-1])) {
    $section = $section[0..($section.Count - 2)]
  }

  if ($section.Count -le 1) {
    throw "版本 $Version 的更新记录为空。"
  }

  return $section
}

$defaultWebDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$defaultChangelog = Join-Path $defaultWebDir "docs\CHANGELOG.md"
$changelogFile = Resolve-RequiredFile -Value $env:TERMOUS_CHANGELOG_FILE -Fallback $defaultChangelog -Name "TERMOUS_CHANGELOG_FILE"
$version = $env:TERMOUS_VERSION
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "TERMOUS_VERSION 为空，无法提取 Release 更新记录。"
}

$outputFile = if ([string]::IsNullOrWhiteSpace($env:TERMOUS_RELEASE_NOTES_FILE)) {
  Join-Path $defaultWebDir "build\release-notes.md"
} else {
  $env:TERMOUS_RELEASE_NOTES_FILE
}
$outputFile = [System.IO.Path]::GetFullPath($outputFile)
$outputDir = Split-Path -Parent $outputFile
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$lines = Get-Content -LiteralPath $changelogFile
$section = Get-ChangelogSection -Lines $lines -Version $version
Set-Content -LiteralPath $outputFile -Value $section -Encoding UTF8

Write-Host "Release notes generated: $outputFile"
