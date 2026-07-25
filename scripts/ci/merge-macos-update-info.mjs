import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  hashRegularFile,
  readUpdateManifest,
  requireReleaseArchitecture,
  requireReleaseVersion,
  stringifyUpdateManifest,
  validateUpdateManifest,
} from "./release-manifest-contract.mjs";

const STRUCTURAL_KEYS = new Set([
  "files",
  "path",
  "releaseDate",
  "sha512",
  "version",
]);
const RELEASE_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function parseArguments(argv) {
  const values = new Map();
  let command = "merge";
  let offset = 0;
  if (
    argv[0] === "merge" ||
    argv[0] === "partial" ||
    argv[0] === "refresh"
  ) {
    command = argv[0];
    offset = 1;
  }
  for (let index = offset; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`参数必须使用 --name value 形式: ${String(key)}`);
    }
    if (values.has(key)) {
      throw new Error(`参数不能重复: ${key}`);
    }
    values.set(key, value);
  }
  return { command, values };
}

function takeRequired(values, key) {
  const value = values.get(key);
  if (!value) {
    throw new Error(`缺少必需参数: ${key}`);
  }
  values.delete(key);
  return value;
}

function takeOptional(values, key) {
  const value = values.get(key);
  values.delete(key);
  return value;
}

function assertNoUnknownArguments(values) {
  if (values.size > 0) {
    throw new Error(`包含未知参数: ${[...values.keys()].join(", ")}`);
  }
}

function requireReleaseDate(value, label) {
  if (
    typeof value !== "string" ||
    !RELEASE_DATE_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label}必须是 UTC ISO 8601 时间`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function sharedFields(manifest) {
  return Object.fromEntries(
    Object.keys(manifest)
      .filter((key) => !STRUCTURAL_KEYS.has(key))
      .sort()
      .map((key) => [key, canonicalize(manifest[key])]),
  );
}

function assertSharedFieldsEqual(x64Manifest, arm64Manifest) {
  const x64Fields = JSON.stringify(sharedFields(x64Manifest));
  const arm64Fields = JSON.stringify(sharedFields(arm64Manifest));
  if (x64Fields !== arm64Fields) {
    throw new Error("macOS partial manifest 的共同字段不一致");
  }
}

function chooseReleaseDate(x64Manifest, arm64Manifest, override) {
  if (override !== undefined) {
    return requireReleaseDate(override, "--release-date ");
  }
  const x64Date = x64Manifest.releaseDate;
  const arm64Date = arm64Manifest.releaseDate;
  if (x64Date === undefined && arm64Date === undefined) {
    return undefined;
  }
  if (x64Date !== arm64Date) {
    throw new Error(
      "macOS partial manifest 的 releaseDate 不一致，请显式传入 --release-date",
    );
  }
  return requireReleaseDate(x64Date, "releaseDate ");
}

function compareMacEntries(left, right) {
  const archRank = (entry) => (entry.url.includes("-arm64.") ? 1 : 0);
  const typeRank = (entry) => (entry.url.endsWith(".zip") ? 0 : 1);
  return (
    archRank(left) - archRank(right) ||
    typeRank(left) - typeRank(right) ||
    left.url.localeCompare(right.url, "en")
  );
}

function buildCanonicalManifest({
  entries,
  releaseDate,
  shared,
  version,
}) {
  const sortedEntries = [...entries].sort(compareMacEntries);
  const legacyEntry =
    sortedEntries.find(
      ({ url }) => url.includes("-x64.") && url.endsWith(".zip"),
    ) ?? sortedEntries.find(({ url }) => url.endsWith(".zip"));
  if (!legacyEntry) {
    throw new Error("macOS manifest 缺少 ZIP 更新载荷");
  }
  return {
    version,
    files: sortedEntries,
    path: legacyEntry.url,
    sha512: legacyEntry.sha512,
    ...(releaseDate === undefined ? {} : { releaseDate }),
    ...shared,
  };
}

async function writeAtomic(outputPath, contents) {
  const resolvedOutput = path.resolve(outputPath);
  const temporaryPath = `${resolvedOutput}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, resolvedOutput);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function normalizeMacosPartial({
  arch,
  inputPath,
  outputPath,
  releaseDate,
  version,
}) {
  requireReleaseArchitecture(arch);
  requireReleaseVersion(version);
  const manifest = await readUpdateManifest(inputPath);
  const { entries } = validateUpdateManifest(manifest, {
    arch,
    platform: "macos",
    source: path.basename(inputPath),
    version,
  });
  const canonical = buildCanonicalManifest({
    entries,
    releaseDate:
      releaseDate === undefined
        ? manifest.releaseDate
        : requireReleaseDate(releaseDate, "--release-date "),
    shared: sharedFields(manifest),
    version,
  });
  await writeAtomic(outputPath, stringifyUpdateManifest(canonical));
  return canonical;
}

export async function refreshMacosManifestAsset({
  arch,
  assetPath,
  inputPath,
  outputPath,
  version,
}) {
  requireReleaseArchitecture(arch);
  requireReleaseVersion(version);
  const manifest = await readUpdateManifest(inputPath);
  const { entries } = validateUpdateManifest(manifest, {
    arch,
    platform: "macos",
    source: path.basename(inputPath),
    version,
  });
  const assetName = path.basename(assetPath);
  if (!entries.some(({ url }) => url === assetName)) {
    throw new Error(`macOS manifest 未引用待刷新资产: ${assetName}`);
  }
  const digest = await hashRegularFile(assetPath, assetName);
  const files = entries.map((entry) =>
    entry.url === assetName
      ? { ...entry, sha512: digest.sha512, size: digest.size }
      : entry,
  );
  const refreshed = {
    ...manifest,
    files,
    ...(manifest.path === assetName ? { sha512: digest.sha512 } : {}),
  };
  validateUpdateManifest(refreshed, {
    arch,
    platform: "macos",
    source: path.basename(outputPath),
    version,
  });
  await writeAtomic(outputPath, stringifyUpdateManifest(refreshed));
  return refreshed;
}

export async function mergeMacosUpdateInfo({
  arm64Path,
  outputPath,
  releaseDate,
  version,
  x64Path,
}) {
  requireReleaseVersion(version);
  const [x64Manifest, arm64Manifest] = await Promise.all([
    readUpdateManifest(x64Path),
    readUpdateManifest(arm64Path),
  ]);
  const x64 = validateUpdateManifest(x64Manifest, {
    arch: "x64",
    platform: "macos",
    source: path.basename(x64Path),
    version,
  });
  const arm64 = validateUpdateManifest(arm64Manifest, {
    arch: "arm64",
    platform: "macos",
    source: path.basename(arm64Path),
    version,
  });
  assertSharedFieldsEqual(x64Manifest, arm64Manifest);
  const canonical = buildCanonicalManifest({
    entries: [...x64.entries, ...arm64.entries],
    releaseDate: chooseReleaseDate(x64Manifest, arm64Manifest, releaseDate),
    shared: sharedFields(x64Manifest),
    version,
  });
  validateUpdateManifest(canonical, {
    platform: "macos",
    source: path.basename(outputPath),
    version,
  });
  await writeAtomic(outputPath, stringifyUpdateManifest(canonical));
  return canonical;
}

async function main(argv) {
  const { command, values } = parseArguments(argv);
  const version = takeRequired(values, "--version");
  const outputPath = takeRequired(values, "--output");
  const releaseDate = takeOptional(values, "--release-date");
  if (command === "refresh") {
    if (releaseDate !== undefined) {
      throw new Error("refresh 不接受 --release-date");
    }
    const inputPath = takeRequired(values, "--input");
    const assetPath = takeRequired(values, "--asset");
    const arch = takeRequired(values, "--arch");
    assertNoUnknownArguments(values);
    await refreshMacosManifestAsset({
      arch,
      assetPath,
      inputPath,
      outputPath,
      version,
    });
    return;
  }
  if (command === "partial") {
    const inputPath = takeRequired(values, "--input");
    const arch = takeRequired(values, "--arch");
    assertNoUnknownArguments(values);
    await normalizeMacosPartial({
      arch,
      inputPath,
      outputPath,
      releaseDate,
      version,
    });
    return;
  }
  const x64Path = takeRequired(values, "--x64");
  const arm64Path = takeRequired(values, "--arm64");
  assertNoUnknownArguments(values);
  await mergeMacosUpdateInfo({
    arm64Path,
    outputPath,
    releaseDate,
    version,
    x64Path,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `macOS 更新清单处理失败: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
