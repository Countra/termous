import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";

import {
  expectedReleaseContract,
  hashRegularFile,
  readUpdateManifest,
  requirePositiveSize,
  requireReleaseVersion,
  requireSafeAssetName,
  requireSha256,
  resolveAssetFile,
  validateUpdateManifest,
} from "./release-manifest-contract.mjs";
import { readAssetReceipt } from "./release-receipt.mjs";

const PHASE_ALIASES = new Map([
  ["receipts", "receipts"],
  ["pre-cleanup", "receipts"],
  ["final", "final"],
  ["after-cleanup", "final"],
]);

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value;
}

function requirePhase(value) {
  const phase = PHASE_ALIASES.get(value);
  if (!phase) {
    throw new Error(`未知资产校验阶段: ${String(value)}`);
  }
  return phase;
}

function expectedPrerelease(version) {
  return version.includes("-");
}

function validateReleaseMetadata(release, { tag, version }) {
  requireRecord(release, "Release JSON");
  if (tag !== `v${version}`) {
    throw new Error(`Release tag 必须与版本一致: 期望 v${version}`);
  }
  if (release.tag_name !== tag) {
    throw new Error(
      `Release tag 冲突: 期望 ${tag}，实际 ${String(release.tag_name)}`,
    );
  }
  if (release.draft !== true) {
    throw new Error("Release 必须保持 Draft，才能执行公开前门禁");
  }
  if (release.prerelease !== expectedPrerelease(version)) {
    throw new Error("Release prerelease 标志与版本不一致");
  }
  if (typeof release.body !== "string" || release.body.trim().length === 0) {
    throw new Error("Release notes 不能为空");
  }
  if (!Array.isArray(release.assets)) {
    throw new Error("Release JSON 缺少 assets 数组");
  }
}

export function createReleaseSnapshotFingerprint(release) {
  requireRecord(release, "Release JSON");
  if (!Array.isArray(release.assets)) {
    throw new Error("Release JSON 缺少 assets 数组");
  }
  const assets = release.assets
    .map((rawAsset, index) => {
      const asset = requireRecord(rawAsset, `assets[${index}]`);
      return [
        asset.url ?? null,
        asset.name ?? null,
        asset.size ?? null,
        asset.digest ?? null,
        asset.updated_at ?? null,
      ];
    })
    .sort(([left], [right]) => {
      const leftValue = String(left);
      const rightValue = String(right);
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });
  const snapshot = [
    release.id ?? null,
    release.tag_name ?? null,
    release.draft ?? null,
    release.prerelease ?? null,
    release.body ?? null,
    assets,
  ];
  return createHash("sha256")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("hex");
}

export function createReleaseContentFingerprint(entries) {
  const snapshot = [...entries]
    .map(({ name, sha256, sha512, size }) => [name, size, sha256, sha512])
    .sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
  return createHash("sha256")
    .update(JSON.stringify(snapshot), "utf8")
    .digest("hex");
}

function parseApiDigest(value, assetName) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !value.startsWith("sha256:")) {
    throw new Error(`${assetName} 的 GitHub digest 格式不受支持`);
  }
  return requireSha256(value.slice("sha256:".length), `${assetName} digest`);
}

function requireAssetReleaseUrl(value, { assetName, tag }) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${assetName} 的 browser_download_url 无效`, {
      cause: error,
    });
  }
  const expectedPath = `/Countra/termous/releases/download/${tag}/${assetName}`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.pathname !== expectedPath ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${assetName} 未指向同一 Termous Draft Release`);
  }
  return url.href;
}

function indexReleaseAssets(release, tag) {
  const assets = new Map();
  const downloadUrls = new Set();
  for (const [index, rawAsset] of release.assets.entries()) {
    const asset = requireRecord(rawAsset, `assets[${index}]`);
    const name = requireSafeAssetName(asset.name, `assets[${index}].name`);
    if (assets.has(name)) {
      throw new Error(`Release 包含重复资产名: ${name}`);
    }
    const downloadUrl = requireAssetReleaseUrl(asset.browser_download_url, {
      assetName: name,
      tag,
    });
    if (downloadUrls.has(downloadUrl)) {
      throw new Error(`Release 包含重复下载 URL: ${downloadUrl}`);
    }
    downloadUrls.add(downloadUrl);
    assets.set(name, {
      digest: parseApiDigest(asset.digest, name),
      name,
      size: requirePositiveSize(asset.size, `${name} API size`),
    });
  }
  return assets;
}

function compareAssetSets(actual, expected, contract) {
  const actualNames = new Set(actual.keys());
  const expectedNames = new Set(expected);
  const partials = contract.partials.filter((name) => actualNames.has(name));
  if (partials.length > 0) {
    throw new Error(`Release 仍包含 macOS partial: ${partials.join(", ")}`);
  }
  const unexpected = [...actualNames]
    .filter((name) => !expectedNames.has(name))
    .sort();
  const missing = [...expectedNames]
    .filter((name) => !actualNames.has(name))
    .sort();
  if (unexpected.length > 0) {
    throw new Error(`Release 包含未知或旧版本资产: ${unexpected.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new Error(`Release 缺少资产: ${missing.join(", ")}`);
  }
}

async function assertDirectoryMatches(assetsDirectory, expectedNames) {
  const entries = await readdir(assetsDirectory, { withFileTypes: true });
  const actual = new Set();
  for (const entry of entries) {
    requireSafeAssetName(entry.name, "本地资产名");
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`本地资产目录包含非普通文件: ${entry.name}`);
    }
    actual.add(entry.name);
  }
  const expected = new Set(expectedNames);
  const unexpected = [...actual].filter((name) => !expected.has(name)).sort();
  const missing = [...expected].filter((name) => !actual.has(name)).sort();
  if (unexpected.length > 0) {
    throw new Error(`本地目录包含未知资产: ${unexpected.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new Error(`本地目录缺少资产: ${missing.join(", ")}`);
  }
}

async function createDigestReader(assetsDirectory, apiAssets) {
  const cache = new Map();
  return async (assetName) => {
    if (!cache.has(assetName)) {
      cache.set(
        assetName,
        hashRegularFile(
          resolveAssetFile(assetsDirectory, assetName),
          assetName,
        ),
      );
    }
    const digest = await cache.get(assetName);
    const apiAsset = apiAssets.get(assetName);
    if (!apiAsset) {
      throw new Error(`Release API 未列出本地资产: ${assetName}`);
    }
    if (apiAsset.size !== digest.size) {
      throw new Error(`${assetName} 的 API size 与实际文件不一致`);
    }
    if (apiAsset.digest !== null && apiAsset.digest !== digest.sha256) {
      throw new Error(`${assetName} 的 GitHub SHA256 digest 与实际文件不一致`);
    }
    return digest;
  };
}

async function verifyManifests({
  assetsDirectory,
  digestFor,
  version,
}) {
  const specifications = [
    { name: "latest.yml", platform: "windows" },
    { name: "latest-linux.yml", platform: "linux" },
    { name: "latest-mac.yml", platform: "macos" },
  ];
  for (const specification of specifications) {
    const manifest = await readUpdateManifest(
      resolveAssetFile(assetsDirectory, specification.name),
    );
    const validated = validateUpdateManifest(manifest, {
      platform: specification.platform,
      source: specification.name,
      version,
    });
    for (const entry of validated.entries) {
      const digest = await digestFor(entry.url);
      if (entry.size !== digest.size || entry.sha512 !== digest.sha512) {
        throw new Error(
          `${specification.name} 中 ${entry.url} 的 SHA512 或 size 错误`,
        );
      }
    }
  }
}

async function verifyReceipts({
  assetsDirectory,
  contract,
  digestFor,
  version,
}) {
  for (const target of contract.receiptTargets) {
    const receiptName = `${target.name}.receipt.json`;
    const receipt = await readAssetReceipt(
      resolveAssetFile(assetsDirectory, receiptName),
      {
        expectedAsset: target.name,
        version,
      },
    );
    const digest = await digestFor(target.name);
    if (
      receipt.size !== digest.size ||
      receipt.sha256 !== digest.sha256 ||
      receipt.sha512 !== digest.sha512
    ) {
      throw new Error(`${receiptName} 与最终资产的摘要或大小不一致`);
    }
    await digestFor(receiptName);
  }
}

export async function verifyReleaseAssets({
  assetsDirectory,
  phase: rawPhase,
  release,
  tag,
  version,
}) {
  requireReleaseVersion(version);
  const phase = requirePhase(rawPhase);
  validateReleaseMetadata(release, { tag, version });
  const contract = expectedReleaseContract(version);
  const expectedNames =
    phase === "receipts"
      ? [...contract.finalAssets, ...contract.receipts]
      : contract.finalAssets;
  const apiAssets = indexReleaseAssets(release, tag);
  compareAssetSets(apiAssets, expectedNames, contract);
  await assertDirectoryMatches(assetsDirectory, expectedNames);
  const digestFor = await createDigestReader(assetsDirectory, apiAssets);
  const contentEntries = await Promise.all(
    contract.finalAssets.map(async (name) => ({
      name,
      ...(await digestFor(name)),
    })),
  );
  await verifyManifests({ assetsDirectory, digestFor, version });
  if (phase === "receipts") {
    await verifyReceipts({
      assetsDirectory,
      contract,
      digestFor,
      version,
    });
  }
  return {
    assetCount: expectedNames.length,
    contentFingerprint: createReleaseContentFingerprint(contentEntries),
    fallbackDigestCount: [...apiAssets.values()].filter(
      ({ digest }) => digest === null,
    ).length,
    phase,
    releaseFingerprint: createReleaseSnapshotFingerprint(release),
    tag,
    version,
  };
}
