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

function Assert-ChildDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $absolutePath = [System.IO.Path]::GetFullPath($Path)
  $absoluteRoot = [System.IO.Path]::GetFullPath($Root)
  $relativePath = [System.IO.Path]::GetRelativePath($absoluteRoot, $absolutePath)
  if (
    [string]::IsNullOrWhiteSpace($relativePath) -or
    $relativePath -eq "." -or
    [System.IO.Path]::IsPathRooted($relativePath) -or
    $relativePath -eq ".." -or
    $relativePath.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")
  ) {
    throw "$Name 必须位于 $absoluteRoot 内: $absolutePath"
  }
}

function Assert-OrdinaryDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Name 不存在或不是目录: $Path"
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Name 不能是符号链接或联接: $Path"
  }
  $absolutePath = [System.IO.Path]::GetFullPath($Path)
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  if (-not [string]::Equals(
    $absolutePath,
    $resolvedPath,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "$Name 不能包含路径别名: $Path"
  }
}

function Prepare-CoreOutputDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$BuildRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
  )

  Assert-OrdinaryDirectory -Path $BuildRoot -Name "Web 构建资源目录"
  if (Test-Path -LiteralPath $OutputDirectory) {
    Assert-OrdinaryDirectory -Path $OutputDirectory -Name "Core 输出目录"
  } else {
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
    Assert-OrdinaryDirectory -Path $OutputDirectory -Name "Core 输出目录"
  }
  foreach ($binaryName in @("termous-core.exe", "termous-core")) {
    $binaryPath = Join-Path $OutputDirectory $binaryName
    if (Test-Path -LiteralPath $binaryPath) {
      if (Test-Path -LiteralPath $binaryPath -PathType Container) {
        throw "Core 输出文件不能是目录: $binaryPath"
      }
      Remove-Item -LiteralPath $binaryPath -Force
    }
  }
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

function Use-CodeSigningDefaults {
  $certificateVars = @("CSC_LINK", "WIN_CSC_LINK")
  $passwordVars = @("CSC_KEY_PASSWORD", "WIN_CSC_KEY_PASSWORD")
  $hasCertificate = $false

  foreach ($name in $certificateVars) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($value)) {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    } else {
      $hasCertificate = $true
    }
  }

  foreach ($name in $passwordVars) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($value)) {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
  }

  if (-not $hasCertificate) {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    Write-Host "Windows code signing disabled; unsigned installer will be built."
  }
}

function Clear-PublishCredentials {
  $credentialVars = @(
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_RELEASE_TOKEN",
    "GITLAB_TOKEN",
    "BITBUCKET_TOKEN",
    "KEYGEN_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "DO_KEY",
    "DO_SECRET_KEY",
    "SNAPCRAFT_STORE_CREDENTIALS"
  )
  foreach ($name in $credentialVars) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
}

function Resolve-BuildPhase {
  $phase = if ([string]::IsNullOrWhiteSpace($env:TERMOUS_BUILD_PHASE)) {
    "all"
  } else {
    $env:TERMOUS_BUILD_PHASE.Trim().ToLowerInvariant()
  }
  if ($phase -notin @("all", "prepare", "package")) {
    throw "TERMOUS_BUILD_PHASE 必须是 all、prepare 或 package: $phase"
  }
  return $phase
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
$phase = Resolve-BuildPhase
$version = if ([string]::IsNullOrWhiteSpace($env:TERMOUS_VERSION)) {
  Read-PackageVersion -WebDir $webDir
} else {
  $env:TERMOUS_VERSION
}

if ([string]::IsNullOrWhiteSpace($version)) {
  throw "TERMOUS_VERSION 为空，无法构建发布产物。"
}

Assert-ChildDirectory -Path $outputDir -Root $workspaceDir -Name "TERMOUS_OUTPUT_DIR"
Assert-ChildDirectory -Path $installerDir -Root $outputDir -Name "安装包输出目录"
Assert-ChildDirectory -Path $coreOutputDir -Root (Join-Path $webDir "build") -Name "Core 输出目录"
Clear-PublishCredentials

Write-Host "Termous Windows build"
Write-Host "webDir=$webDir"
Write-Host "coreDir=$coreDir"
Write-Host "outputDir=$outputDir"
Write-Host "version=$version"
Write-Host "phase=$phase"

$env:VITE_TERMOUS_APP_VERSION = $version

if ($phase -in @("all", "prepare")) {
  Prepare-CoreOutputDirectory `
    -BuildRoot (Join-Path $webDir "build") `
    -OutputDirectory $coreOutputDir
  Enable-MingwIfAvailable

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
  Invoke-Native -Name "Typecheck web" -FilePath "pnpm" -Arguments @("run", "typecheck") -WorkingDirectory $webDir
  Invoke-Native -Name "Build Vite bundles" -FilePath "pnpm" -Arguments @("run", "build:renderer") -WorkingDirectory $webDir
}

if ($phase -in @("all", "package")) {
  if (-not (Test-Path -LiteralPath $coreExe -PathType Leaf)) {
    throw "打包前缺少 termous-core.exe，请先执行 prepare 阶段: $coreExe"
  }
  foreach ($bundleDirectory in @("dist", "dist-electron")) {
    $bundlePath = Join-Path $webDir $bundleDirectory
    if (-not (Test-Path -LiteralPath $bundlePath -PathType Container)) {
      throw "打包前缺少 $bundleDirectory，请先执行 prepare 阶段: $bundlePath"
    }
  }

  Use-CodeSigningDefaults
  Invoke-Native -Name "Build Windows installer" -FilePath "node" -Arguments @(
    "scripts/ci/build-local-package.mjs",
    "--output",
    $installerDir,
    "--platform",
    "win32",
    "--arch",
    "x64",
    "--version",
    $version
  ) -WorkingDirectory $webDir

  $artifacts = Get-ChildItem -LiteralPath $installerDir -File -ErrorAction SilentlyContinue
  Write-Host "Generated artifacts:"
  $artifacts | ForEach-Object { Write-Host "- $($_.FullName)" }
}
