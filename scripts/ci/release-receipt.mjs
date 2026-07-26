import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  expectedReleaseContract,
  hashRegularFile,
  readUpdateManifest,
  requirePositiveSize,
  requireReleaseArchitecture,
  requireReleaseVersion,
  requireSafeAssetName,
  requireSha256,
  requireSha512,
  validateUpdateManifest,
} from "./release-manifest-contract.mjs";

const RECEIPT_KEYS = new Set([
  "arch",
  "asset",
  "kind",
  "platform",
  "schemaVersion",
  "sha256",
  "sha512",
  "size",
  "version",
]);

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value;
}

function findReceiptTarget(version, platform, arch, assetName) {
  requireReleaseVersion(version);
  requireReleaseArchitecture(arch, platform);
  const target = expectedReleaseContract(version).receiptTargets.find(
    (candidate) =>
      candidate.name === assetName &&
      candidate.platform === platform &&
      candidate.arch === arch,
  );
  if (!target) {
    throw new Error(`资产不属于 ${platform}/${arch} Release 契约: ${assetName}`);
  }
  return target;
}

export async function createAssetReceipt({
  arch,
  assetPath,
  manifestPath,
  platform,
  version,
}) {
  const assetName = requireSafeAssetName(path.basename(assetPath));
  const target = findReceiptTarget(version, platform, arch, assetName);
  const digest = await hashRegularFile(assetPath, assetName);
  if (target.manifest !== null) {
    if (!manifestPath || path.basename(manifestPath) !== target.manifest) {
      throw new Error(`${assetName} 必须使用 ${target.manifest} 交叉校验`);
    }
    const manifest = await readUpdateManifest(manifestPath);
    const validated = validateUpdateManifest(manifest, {
      arch,
      platform,
      source: target.manifest,
      version,
    });
    const entry = validated.entries.find(({ url }) => url === assetName);
    if (!entry) {
      throw new Error(`${target.manifest} 未引用 ${assetName}`);
    }
    if (entry.size !== digest.size || entry.sha512 !== digest.sha512) {
      throw new Error(`${assetName} 与 ${target.manifest} 的摘要或大小不一致`);
    }
  } else if (manifestPath !== undefined) {
    throw new Error(`${assetName} 是 sidecar，不接受 --manifest`);
  }
  return {
    schemaVersion: 2,
    version,
    platform,
    arch,
    kind: target.manifest === null ? "sidecar" : "payload",
    asset: assetName,
    size: digest.size,
    sha256: digest.sha256,
    sha512: digest.sha512,
  };
}

export function validateAssetReceipt(
  rawReceipt,
  { expectedAsset, version, source = "receipt" },
) {
  const receipt = requireRecord(rawReceipt, source);
  for (const key of Object.keys(receipt)) {
    if (!RECEIPT_KEYS.has(key)) {
      throw new Error(`${source} 包含未知字段: ${key}`);
    }
  }
  for (const key of RECEIPT_KEYS) {
    if (!(key in receipt)) {
      throw new Error(`${source} 缺少字段: ${key}`);
    }
  }
  if (receipt.schemaVersion !== 2) {
    throw new Error(`${source} schemaVersion 必须是 2`);
  }
  if (receipt.version !== version) {
    throw new Error(`${source} 版本冲突`);
  }
  const asset = requireSafeAssetName(receipt.asset, `${source} asset`);
  if (asset !== expectedAsset) {
    throw new Error(`${source} 资产名冲突: ${asset}`);
  }
  const target = findReceiptTarget(
    version,
    receipt.platform,
    receipt.arch,
    asset,
  );
  const expectedKind = target.manifest === null ? "sidecar" : "payload";
  if (receipt.kind !== expectedKind) {
    throw new Error(`${source} kind 必须是 ${expectedKind}`);
  }
  return {
    ...receipt,
    sha256: requireSha256(receipt.sha256, `${source} sha256`),
    sha512: requireSha512(receipt.sha512, `${source} sha512`),
    size: requirePositiveSize(receipt.size, `${source} size`),
  };
}

export async function readAssetReceipt(
  receiptPath,
  { expectedAsset, version },
) {
  let value;
  try {
    value = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(
      `${path.basename(receiptPath)} JSON 无效: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  return validateAssetReceipt(value, {
    expectedAsset,
    source: path.basename(receiptPath),
    version,
  });
}

export function stringifyAssetReceipt(receipt) {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}
