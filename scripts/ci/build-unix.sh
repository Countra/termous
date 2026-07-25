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
  node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$target"
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

clear_publish_credentials() {
  local names=(
    GH_TOKEN
    GITHUB_TOKEN
    GITHUB_RELEASE_TOKEN
    GITLAB_TOKEN
    BITBUCKET_TOKEN
    KEYGEN_TOKEN
    AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY
    AWS_SESSION_TOKEN
    AWS_PROFILE
    DO_KEY
    DO_SECRET_KEY
    SNAPCRAFT_STORE_CREDENTIALS
  )
  local name
  for name in "${names[@]}"; do
    unset "$name"
  done
}

resolve_build_phase() {
  local phase="${TERMOUS_BUILD_PHASE:-all}"
  phase="$(printf '%s' "$phase" | tr '[:upper:]' '[:lower:]')"
  case "$phase" in
    all|prepare|package)
      printf '%s\n' "$phase"
      ;;
    *)
      echo "TERMOUS_BUILD_PHASE 必须是 all、prepare 或 package: $phase" >&2
      return 1
      ;;
  esac
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
default_web_dir="$(cd "$script_dir/../.." && pwd -P)"
web_dir="$(resolve_existing_directory "${TERMOUS_WEB_DIR:-}" "$default_web_dir" "TERMOUS_WEB_DIR")"
workspace_dir="$(dirname "$web_dir")"
core_dir="$(resolve_existing_directory "${TERMOUS_CORE_DIR:-}" "$workspace_dir/backend" "TERMOUS_CORE_DIR")"
target_os="${TERMOUS_TARGET_OS:-}"
target_arch="${TERMOUS_ARCH:-}"
build_phase="$(resolve_build_phase)"

case "$target_os:$target_arch" in
  linux:x64)
    goos="linux"
    goarch="amd64"
    expected_native_arch="x86_64"
    compiler="gcc"
    ;;
  darwin:x64)
    goos="darwin"
    goarch="amd64"
    expected_native_arch="x86_64"
    compiler="clang"
    ;;
  darwin:arm64)
    goos="darwin"
    goarch="arm64"
    expected_native_arch="arm64"
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
if [[ "$build_phase" != "package" ]] && ! command -v "$compiler" >/dev/null 2>&1; then
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
echo "phase=$build_phase"

export VITE_TERMOUS_APP_VERSION="$version"
clear_publish_credentials

if [[ "$build_phase" == "all" || "$build_phase" == "prepare" ]]; then
  reset_directory "$core_output_dir"
  export CGO_ENABLED=1
  export GOOS="$goos"
  export GOARCH="$goarch"
  export CC="$compiler"

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
  run_step "Typecheck web" "$web_dir" pnpm run typecheck
  run_step "Build Vite bundles" "$web_dir" pnpm run build:renderer
fi

if [[ "$build_phase" == "all" || "$build_phase" == "package" ]]; then
  if [[ ! -x "$core_binary" ]]; then
    echo "打包前缺少 termous-core，请先执行 prepare 阶段: $core_binary" >&2
    exit 1
  fi
  for bundle_directory in dist dist-electron; do
    if [[ ! -d "$web_dir/$bundle_directory" ]]; then
      echo "打包前缺少 $bundle_directory，请先执行 prepare 阶段: $web_dir/$bundle_directory" >&2
      exit 1
    fi
  done

  reset_directory "$installer_dir"
  run_step "Build $target_os package" "$web_dir" node \
    scripts/ci/build-local-package.mjs \
    --output "$installer_dir" \
    --platform "$target_os" \
    --arch "$target_arch" \
    --version "$version"

  echo "Generated artifacts:"
  find "$installer_dir" -maxdepth 1 -type f -print | sort
fi
