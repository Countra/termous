import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { parseDocument, stringify } from "yaml";

const RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const FILE_ENTRY_KEYS = new Set(["url", "sha512", "size", "blockMapSize"]);

export const RELEASE_PLATFORMS = Object.freeze([
  "windows",
  "linux",
  "macos",
]);
export const RELEASE_ARCHITECTURES = Object.freeze(["x64", "arm64"]);

export function requireReleaseVersion(value, label = "版本") {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !RELEASE_VERSION_PATTERN.test(value)
  ) {
    throw new Error(`${label}不是受支持的发布版本: ${String(value)}`);
  }
  if (value.toLowerCase().includes("arm64")) {
    throw new Error(`${label}不能包含保留的架构标识 arm64: ${value}`);
  }
  return value;
}

export function requireReleaseArchitecture(value, platform = "macos") {
  const supported = platform === "macos" ? RELEASE_ARCHITECTURES : ["x64"];
  if (!supported.includes(value)) {
    throw new Error(`${platform} 缺少或包含不受支持的架构: ${String(value)}`);
  }
  return value;
}

export function requireSafeAssetName(value, label = "资产名") {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 240 ||
    value !== path.basename(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("%") ||
    value.includes(":") ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    throw new Error(`${label}必须是安全的单层文件名: ${String(value)}`);
  }
  return value;
}

export function requireSha256(value, label = "SHA256") {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label}必须是 64 位小写十六进制摘要`);
  }
  return value;
}

export function requireSha512(value, label = "SHA512") {
  if (typeof value !== "string") {
    throw new Error(`${label}必须是 Base64 字符串`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 64 || decoded.toString("base64") !== value) {
    throw new Error(`${label}不是规范的 SHA512 Base64 摘要`);
  }
  return value;
}

export function requirePositiveSize(value, label = "size") {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}必须是正安全整数`);
  }
  return value;
}

function requireRecord(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`${label}必须是对象`);
  }
  return value;
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

export function parseUpdateManifestText(text, source = "manifest") {
  const document = parseDocument(text, {
    maxAliasCount: 0,
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(
      `${source} YAML 无效: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  if (document.warnings.length > 0) {
    throw new Error(
      `${source} YAML 包含不允许的警告: ${document.warnings
        .map((warning) => warning.message)
        .join("; ")}`,
    );
  }
  try {
    return requireRecord(
      document.toJS({ maxAliasCount: 0 }),
      `${source} 根节点`,
    );
  } catch (error) {
    throw new Error(
      `${source} YAML 无法安全解析: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function readUpdateManifest(filePath) {
  return parseUpdateManifestText(
    await readFile(filePath, "utf8"),
    path.basename(filePath),
  );
}

export function expectedReleaseContract(version) {
  requireReleaseVersion(version);
  const prefix = `Termous-${version}`;
  const payloads = [
    {
      arch: "x64",
      manifest: "latest.yml",
      name: `${prefix}-windows-x64-setup.exe`,
      platform: "windows",
      signature: "verified",
    },
    {
      arch: "x64",
      manifest: "latest-linux.yml",
      name: `${prefix}-linux-x64.AppImage`,
      platform: "linux",
      signature: "not-required",
    },
    ...["x64", "arm64"].flatMap((arch) =>
      ["zip", "dmg"].map((extension) => ({
        arch,
        manifest: "latest-mac.yml",
        name: `${prefix}-macos-${arch}.${extension}`,
        platform: "macos",
        signature: "verified",
      })),
    ),
  ];
  const manifests = ["latest.yml", "latest-linux.yml", "latest-mac.yml"];
  const sidecars = [
    `${prefix}-windows-x64-setup.exe.blockmap`,
    ...RELEASE_ARCHITECTURES.map(
      (arch) => `${prefix}-macos-${arch}.zip.blockmap`,
    ),
  ];
  const partials = RELEASE_ARCHITECTURES.map(
    (arch) => `latest-mac.${arch}.partial.yml`,
  );
  const receiptTargets = [
    ...payloads,
    ...sidecars.map((name) => {
      const arch = name.includes("-arm64.") ? "arm64" : "x64";
      const platform = name.includes("-macos-") ? "macos" : "windows";
      return {
        arch,
        manifest: null,
        name,
        platform,
        signature: "not-required",
      };
    }),
  ];
  const receipts = receiptTargets.map(
    ({ name }) => `${name}.receipt.json`,
  );
  return {
    finalAssets: [...payloads.map(({ name }) => name), ...sidecars, ...manifests],
    manifests,
    partials,
    payloads,
    receiptTargets,
    receipts,
    sidecars,
  };
}

function expectedManifestPayloads(version, platform, arch) {
  const payloads = expectedReleaseContract(version).payloads.filter(
    (payload) =>
      payload.platform === platform && (arch === undefined || payload.arch === arch),
  );
  if (payloads.length === 0) {
    throw new Error(`没有 ${platform}/${String(arch)} 对应的载荷契约`);
  }
  return payloads;
}

export function validateUpdateManifest(
  manifest,
  { arch, platform, version, source = "manifest" },
) {
  requireRecord(manifest, `${source} 根节点`);
  requireReleaseVersion(version);
  if (manifest.version !== version) {
    throw new Error(
      `${source} 版本冲突: 期望 ${version}，实际 ${String(manifest.version)}`,
    );
  }
  if (platform === "macos" && arch !== undefined) {
    requireReleaseArchitecture(arch, platform);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${source} files 必须是非空数组`);
  }
  const expected = expectedManifestPayloads(version, platform, arch);
  const expectedNames = new Set(expected.map(({ name }) => name));
  const seen = new Set();
  const entries = manifest.files.map((rawEntry, index) => {
    const entry = requireRecord(rawEntry, `${source} files[${index}]`);
    for (const key of Object.keys(entry)) {
      if (!FILE_ENTRY_KEYS.has(key)) {
        throw new Error(`${source} files[${index}] 包含未知字段: ${key}`);
      }
      if (key === "blockMapSize" && platform !== "linux") {
        throw new Error(
          `${source} files[${index}].blockMapSize 只允许用于 Linux AppImage`,
        );
      }
    }
    const url = requireSafeAssetName(
      entry.url,
      `${source} files[${index}].url`,
    );
    if (seen.has(url)) {
      throw new Error(`${source} 包含重复 URL: ${url}`);
    }
    seen.add(url);
    if (!expectedNames.has(url)) {
      throw new Error(`${source} 包含不符合平台或架构的载荷: ${url}`);
    }
    const size = requirePositiveSize(
      entry.size,
      `${source} files[${index}].size`,
    );
    const blockMapSize =
      platform === "linux"
        ? requirePositiveSize(
            entry.blockMapSize,
            `${source} files[${index}].blockMapSize`,
          )
        : undefined;
    if (blockMapSize !== undefined && blockMapSize > size) {
      throw new Error(
        `${source} files[${index}].blockMapSize 不能大于 AppImage size`,
      );
    }
    return {
      ...(blockMapSize === undefined ? {} : { blockMapSize }),
      sha512: requireSha512(
        entry.sha512,
        `${source} files[${index}].sha512`,
      ),
      size,
      url,
    };
  });
  if (
    entries.length !== expectedNames.size ||
    entries.some(({ url }) => !expectedNames.has(url)) ||
    [...expectedNames].some((name) => !seen.has(name))
  ) {
    throw new Error(
      `${source} 缺少预期载荷: ${[...expectedNames]
        .filter((name) => !seen.has(name))
        .join(", ")}`,
    );
  }
  const legacyPath = requireSafeAssetName(manifest.path, `${source} path`);
  const pathEntry = entries.find(({ url }) => url === legacyPath);
  if (!pathEntry) {
    throw new Error(`${source} path 未指向 files 中的载荷: ${legacyPath}`);
  }
  if (
    requireSha512(manifest.sha512, `${source} sha512`) !== pathEntry.sha512
  ) {
    throw new Error(`${source} 顶层 SHA512 与 path 对应载荷不一致`);
  }
  if (manifest.releaseDate !== undefined) {
    requireReleaseDate(manifest.releaseDate, `${source} releaseDate`);
  }
  return { entries, pathEntry };
}

export function stringifyUpdateManifest(manifest) {
  return stringify(manifest, {
    defaultStringType: "PLAIN",
    lineWidth: 0,
  });
}

export async function hashRegularFile(filePath, label = path.basename(filePath)) {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通文件，不能是符号链接`);
  }
  requirePositiveSize(fileStat.size, `${label} size`);
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) {
    sha256.update(chunk);
    sha512.update(chunk);
  }
  return {
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64"),
    size: fileStat.size,
  };
}

export function resolveAssetFile(assetsDirectory, assetName) {
  requireSafeAssetName(assetName);
  const root = path.resolve(assetsDirectory);
  const resolved = path.resolve(root, assetName);
  if (path.dirname(resolved) !== root) {
    throw new Error(`资产路径越过指定目录: ${assetName}`);
  }
  return resolved;
}
