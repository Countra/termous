#!/usr/bin/env bash
set -Eeuo pipefail

resolve_existing_directory() {
  local value="${1:-}"
  local fallback="$2"
  local name="$3"
  local candidate="$value"
  if [[ -z "$candidate" ]]; then
    candidate="$fallback"
  fi
  if [[ ! -d "$candidate" ]]; then
    echo "$name 不存在或不是目录: $candidate" >&2
    return 1
  fi
  (cd "$candidate" && pwd -P)
}

normalize_output_directory() {
  local target="$1"
  local parent
  local name
  parent="$(dirname "$target")"
  name="$(basename "$target")"
  mkdir -p "$parent"
  parent="$(cd "$parent" && pwd -P)"
  printf '%s/%s\n' "$parent" "$name"
}

reset_directory() {
  local target="$1"
  if [[ -z "$target" || "$target" == "/" ]]; then
    echo "拒绝清理不安全的目录: $target" >&2
    return 1
  fi
  rm -rf -- "$target"
  mkdir -p -- "$target"
}

assert_child_directory() {
  local target="$1"
  local root="$2"
  local name="$3"
  case "$target" in
    "$root"/*) ;;
    *)
      echo "$name 必须位于 $root 内: $target" >&2
      return 1
      ;;
  esac
}

run_step() {
  local name="$1"
  local working_directory="$2"
  local status=0
  shift 2

  echo "::group::$name"
  printf '> '
  printf '%q ' "$@"
  printf '\n'
  if (cd "$working_directory" && "$@"); then
    status=0
  else
    status=$?
  fi
  echo "::endgroup::"
  if [[ "$status" -ne 0 ]]; then
    echo "$name 失败，退出码: $status" >&2
    return "$status"
  fi
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
default_web_dir="$(cd "$script_dir/../.." && pwd -P)"
web_dir="$(resolve_existing_directory "${TERMOUS_WEB_DIR:-}" "$default_web_dir" "TERMOUS_WEB_DIR")"
workspace_dir="$(dirname "$web_dir")"
core_dir="$(resolve_existing_directory "${TERMOUS_CORE_DIR:-}" "$workspace_dir/backend" "TERMOUS_CORE_DIR")"
target_os="${TERMOUS_TARGET_OS:-}"
target_arch="${TERMOUS_ARCH:-}"

case "$target_os:$target_arch" in
  linux:x64)
    goos="linux"
    goarch="amd64"
    expected_native_arch="x86_64"
    package_pattern="*.AppImage"
    builder_platform="--linux"
    builder_target="AppImage"
    builder_arch="--x64"
    compiler="gcc"
    ;;
  darwin:x64)
    goos="darwin"
    goarch="amd64"
    expected_native_arch="x86_64"
    package_pattern="*.dmg"
    builder_platform="--mac"
    builder_target="dmg"
    builder_arch="--x64"
    compiler="clang"
    ;;
  darwin:arm64)
    goos="darwin"
    goarch="arm64"
    expected_native_arch="arm64"
    package_pattern="*.dmg"
    builder_platform="--mac"
    builder_target="dmg"
    builder_arch="--arm64"
    compiler="clang"
    ;;
  *)
    echo "不支持的构建目标: $target_os/$target_arch" >&2
    exit 1
    ;;
esac

native_arch="$(uname -m)"
if [[ "$native_arch" != "$expected_native_arch" ]]; then
  echo "当前 runner 架构为 $native_arch，目标 $target_os/$target_arch 需要 $expected_native_arch" >&2
  exit 1
fi
if ! command -v "$compiler" >/dev/null 2>&1; then
  echo "未找到 $compiler，Termous Core 的 SQLite CGO 构建无法继续。" >&2
  exit 1
fi

default_output_dir="$workspace_dir/build/github-actions/$target_os-$target_arch"
output_dir="$(normalize_output_directory "${TERMOUS_OUTPUT_DIR:-$default_output_dir}")"
installer_dir="$output_dir/installer"
core_output_dir="$web_dir/build/core"
core_binary="$core_output_dir/termous-core"
assert_child_directory "$output_dir" "$workspace_dir" "TERMOUS_OUTPUT_DIR"
assert_child_directory "$core_output_dir" "$web_dir" "Core 输出目录"
version="${TERMOUS_VERSION:-}"
if [[ -z "$version" ]]; then
  version="$(cd "$web_dir" && node -p "require('./package.json').version || '0.0.0-ci'")"
fi
if [[ -z "$version" ]]; then
  echo "TERMOUS_VERSION 为空，无法构建发布产物。" >&2
  exit 1
fi

echo "Termous $target_os/$target_arch build"
echo "webDir=$web_dir"
echo "coreDir=$core_dir"
echo "outputDir=$output_dir"
echo "version=$version"

reset_directory "$installer_dir"
reset_directory "$core_output_dir"

export CGO_ENABLED=1
export GOOS="$goos"
export GOARCH="$goarch"
export CC="$compiler"
export VITE_TERMOUS_APP_VERSION="$version"

run_step "Go tests" "$core_dir" go test ./...
run_step "Build Termous Core" "$core_dir" go build \
  -trimpath \
  -ldflags "-s -w -X termous/backend/internal/buildinfo.Version=$version" \
  -o "$core_binary" \
  ./cmd/termous-core

if [[ ! -x "$core_binary" ]]; then
  echo "termous-core 未生成或不可执行: $core_binary" >&2
  exit 1
fi

run_step "Install web dependencies" "$web_dir" pnpm install --frozen-lockfile
run_step "Typecheck web" "$web_dir" pnpm exec tsc --noEmit
run_step "Build Vite bundles" "$web_dir" pnpm exec vite build
run_step "Build $target_os package" "$web_dir" pnpm exec electron-builder \
  "$builder_platform" \
  "$builder_target" \
  "$builder_arch" \
  --config electron-builder.json5 \
  "--config.directories.output=$installer_dir" \
  "--config.extraMetadata.version=$version" \
  --publish never

if ! find "$installer_dir" -maxdepth 1 -type f -name "$package_pattern" -print -quit | grep -q .; then
  echo "未生成目标安装包 $package_pattern: $installer_dir" >&2
  exit 1
fi

echo "Generated artifacts:"
find "$installer_dir" -maxdepth 1 -type f -print | sort
