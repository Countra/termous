$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-ExistingDirectory {
  param(
    [Parameter(Mandatory = $false)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Fallback,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { $Fallback } else { $Value }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    throw "$Name 不存在或不是目录: $candidate"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Reset-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  Write-Host "::group::$Name"
  Push-Location $WorkingDirectory
  try {
    Write-Host "> $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    if ($exitCode -ne 0) {
      throw "$Name 失败，退出码: $exitCode"
    }
  } finally {
    Pop-Location
    Write-Host "::endgroup::"
  }
}

function Read-PackageVersion {
  param([Parameter(Mandatory = $true)][string]$WebDir)

  $packageJson = Join-Path $WebDir "package.json"
  if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
    return "0.0.0-ci"
  }
  $package = Get-Content -Raw -Path $packageJson | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($package.version)) {
    return "0.0.0-ci"
  }
  return [string]$package.version
}

function Enable-MingwIfAvailable {
  $mingwBin = "C:\msys64\mingw64\bin"
  $gccPath = Join-Path $mingwBin "gcc.exe"
  if ((Test-Path -LiteralPath $gccPath -PathType Leaf) -and ($env:Path -notlike "*$mingwBin*")) {
    $env:Path = "$mingwBin;$env:Path"
  }
  if (Get-Command gcc -ErrorAction SilentlyContinue) {
    $env:CGO_ENABLED = "1"
    $env:CC = "gcc"
    return
  }
  throw "未找到 gcc。Termous Core 使用 SQLite CGO 驱动，Windows 构建需要可用的 MinGW gcc。"
}

$defaultWebDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$webDir = Resolve-ExistingDirectory -Value $env:TERMOUS_WEB_DIR -Fallback $defaultWebDir -Name "TERMOUS_WEB_DIR"
$workspaceDir = Split-Path -Parent $webDir
$coreDir = Resolve-ExistingDirectory -Value $env:TERMOUS_CORE_DIR -Fallback (Join-Path $workspaceDir "backend") -Name "TERMOUS_CORE_DIR"
$outputDir = if ([string]::IsNullOrWhiteSpace($env:TERMOUS_OUTPUT_DIR)) {
  Join-Path $workspaceDir "build\github-actions\windows"
} else {
  $env:TERMOUS_OUTPUT_DIR
}
$outputDir = [System.IO.Path]::GetFullPath($outputDir)
$installerDir = Join-Path $outputDir "installer"
$coreOutputDir = Join-Path $webDir "build\core"
$coreExe = Join-Path $coreOutputDir "termous-core.exe"
$version = if ([string]::IsNullOrWhiteSpace($env:TERMOUS_VERSION)) {
  Read-PackageVersion -WebDir $webDir
} else {
  $env:TERMOUS_VERSION
}

if ([string]::IsNullOrWhiteSpace($version)) {
  throw "TERMOUS_VERSION 为空，无法构建发布产物。"
}

Write-Host "Termous Windows build"
Write-Host "webDir=$webDir"
Write-Host "coreDir=$coreDir"
Write-Host "outputDir=$outputDir"
Write-Host "version=$version"

Reset-Directory -Path $installerDir
Reset-Directory -Path $coreOutputDir
Enable-MingwIfAvailable

$env:VITE_TERMOUS_APP_VERSION = $version

Invoke-Native -Name "Go tests" -FilePath "go" -Arguments @("test", "./...") -WorkingDirectory $coreDir
Invoke-Native -Name "Build Termous Core" -FilePath "go" -Arguments @(
  "build",
  "-trimpath",
  "-ldflags",
  "-s -w -X termous/backend/internal/buildinfo.Version=$version",
  "-o",
  $coreExe,
  "./cmd/termous-core"
) -WorkingDirectory $coreDir

if (-not (Test-Path -LiteralPath $coreExe -PathType Leaf)) {
  throw "termous-core.exe 未生成: $coreExe"
}

Invoke-Native -Name "Install web dependencies" -FilePath "pnpm" -Arguments @("install", "--frozen-lockfile") -WorkingDirectory $webDir
Invoke-Native -Name "Typecheck web" -FilePath "pnpm" -Arguments @("exec", "tsc", "--noEmit") -WorkingDirectory $webDir
Invoke-Native -Name "Build Vite bundles" -FilePath "pnpm" -Arguments @("exec", "vite", "build") -WorkingDirectory $webDir
Invoke-Native -Name "Build Windows installer" -FilePath "pnpm" -Arguments @(
  "exec",
  "electron-builder",
  "--win",
  "nsis",
  "--x64",
  "--config",
  "electron-builder.json5",
  "--config.directories.output=$installerDir",
  "--config.extraMetadata.version=$version",
  "--publish",
  "never"
) -WorkingDirectory $webDir

$artifacts = Get-ChildItem -LiteralPath $installerDir -File -ErrorAction SilentlyContinue
if ($artifacts.Count -eq 0) {
  throw "Windows 安装包目录为空: $installerDir"
}

Write-Host "Generated artifacts:"
$artifacts | ForEach-Object { Write-Host "- $($_.FullName)" }
