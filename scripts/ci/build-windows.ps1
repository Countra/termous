$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# 所有调用方统一代理 buildtools，不再保留第二套编译实现。
$toolRoot = if ($env:TERMOUS_BUILDTOOLS_DIR) { $env:TERMOUS_BUILDTOOLS_DIR } else {
    Join-Path $PSScriptRoot '../../../termous-buildtools'
}
$entry = Join-Path $toolRoot 'build.py'
if (!(Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw '缺少 termous-buildtools，请检出本地构建工具链仓库。'
}
$config = if ($env:TERMOUS_BUILD_CONFIG) { $env:TERMOUS_BUILD_CONFIG } else {
    Join-Path $toolRoot 'configs/local.windows.json'
}
$python = if ($env:PYTHON) { $env:PYTHON } else { 'python' }
$phase = if ($env:TERMOUS_BUILD_PHASE) { $env:TERMOUS_BUILD_PHASE } else { 'all' }
$arguments = @($entry, 'build', '--config', $config, '--phase', $phase)
if ($env:TERMOUS_VERSION) { $arguments += @('--version', $env:TERMOUS_VERSION) }
& $python @arguments
if ($LASTEXITCODE -ne 0) { throw "统一构建失败：$LASTEXITCODE" }
