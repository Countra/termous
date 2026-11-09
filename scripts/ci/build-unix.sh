#!/usr/bin/env bash
set -Eeuo pipefail
# 保留旧入口，构建、检查和打包全部由统一工具链负责。
script_dir="$(cd -- "$(dirname -- "$BASH_SOURCE")" && pwd -P)"
tools="${TERMOUS_BUILDTOOLS_DIR:-$script_dir/../../../termous-buildtools}"
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=linux ;;
  Darwin:arm64) platform=macos ;;
  *) echo '仅支持 Linux x64 和 macOS ARM64' >&2; exit 1 ;;
esac
[[ -f "$tools/build.py" ]] || { echo '缺少 termous-buildtools' >&2; exit 1; }
args=("$tools/build.py" build --config "${TERMOUS_BUILD_CONFIG:-$tools/configs/local.$platform.json}" --phase "${TERMOUS_BUILD_PHASE:-all}")
if [[ -n "${TERMOUS_VERSION:-}" ]]; then args+=(--version "$TERMOUS_VERSION"); fi
exec "${PYTHON:-python3.12}" "${args[@]}"
