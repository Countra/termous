import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MacUpdater } from "electron-updater/out/MacUpdater.js";

import {
  mergeMacosUpdateInfo,
  normalizeMacosPartial,
  refreshMacosManifestAsset,
} from "./merge-macos-update-info.mjs";
import {
  hashRegularFile,
  parseUpdateManifestText,
  stringifyUpdateManifest,
} from "./release-manifest-contract.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(
  currentDirectory,
  "fixtures",
  "release-contract",
);
const x64Fixture = path.join(
  fixtureDirectory,
  "latest-mac.x64.partial.yml",
);
const arm64Fixture = path.join(
  fixtureDirectory,
  "latest-mac.arm64.partial.yml",
);

async function temporaryDirectory(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "termous-macos-manifest-"),
  );
  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) =>
      rm(directory, { force: true, recursive: true }),
    );
  });
  return directory;
}

async function writeManifest(directory, name, manifest) {
  const filePath = path.join(directory, name);
  await writeFile(filePath, stringifyUpdateManifest(manifest), "utf8");
  return filePath;
}

test("确定性合并 x64 和 arm64 清单并保留唯一 canonical 路径", async (t) => {
  const directory = await temporaryDirectory(t);
  const first = path.join(directory, "first.yml");
  const second = path.join(directory, "second.yml");
  const result = await mergeMacosUpdateInfo({
    arm64Path: arm64Fixture,
    outputPath: first,
    version: "1.2.3",
    x64Path: x64Fixture,
  });
  await mergeMacosUpdateInfo({
    arm64Path: arm64Fixture,
    outputPath: second,
    version: "1.2.3",
    x64Path: x64Fixture,
  });
  assert.equal(await readFile(first, "utf8"), await readFile(second, "utf8"));
  assert.equal(result.path, "Termous-1.2.3-macos-x64.zip");
  assert.deepEqual(
    result.files.map(({ url }) => url),
    [
      "Termous-1.2.3-macos-x64.zip",
      "Termous-1.2.3-macos-x64.dmg",
      "Termous-1.2.3-macos-arm64.zip",
      "Termous-1.2.3-macos-arm64.dmg",
    ],
  );
});

test("锁定 electron-updater 6.8.9 能从 canonical 清单选择正确架构 ZIP", async (t) => {
  const directory = await temporaryDirectory(t);
  const outputPath = path.join(directory, "latest-mac.yml");
  const result = await mergeMacosUpdateInfo({
    arm64Path: arm64Fixture,
    outputPath,
    version: "1.2.3",
    x64Path: x64Fixture,
  });
  const files = result.files.map((entry) => ({
    info: entry,
    url: new URL(
      `https://github.com/Countra/termous/releases/download/v1.2.3/${entry.url}`,
    ),
  }));
  const x64Zip = MacUpdater.filterFilesForArch(files, false).find(({ url }) =>
    url.pathname.endsWith(".zip"),
  );
  const arm64Zip = MacUpdater.filterFilesForArch(files, true).find(({ url }) =>
    url.pathname.endsWith(".zip"),
  );
  assert.equal(
    path.basename(x64Zip.url.pathname),
    "Termous-1.2.3-macos-x64.zip",
  );
  assert.equal(
    path.basename(arm64Zip.url.pathname),
    "Termous-1.2.3-macos-arm64.zip",
  );
});

test("partial 入口规范化 builder 清单顺序", async (t) => {
  const directory = await temporaryDirectory(t);
  const outputPath = path.join(directory, "latest-mac.arm64.partial.yml");
  const result = await normalizeMacosPartial({
    arch: "arm64",
    inputPath: arm64Fixture,
    outputPath,
    version: "1.2.3",
  });
  assert.deepEqual(
    result.files.map(({ url }) => url),
    [
      "Termous-1.2.3-macos-arm64.zip",
      "Termous-1.2.3-macos-arm64.dmg",
    ],
  );
});

test("DMG 字节变化后原子刷新 manifest 摘要与大小", async (t) => {
  const directory = await temporaryDirectory(t);
  const inputPath = path.join(directory, "latest-mac.yml");
  const assetPath = path.join(
    directory,
    "Termous-1.2.3-macos-x64.dmg",
  );
  await writeFile(inputPath, await readFile(x64Fixture, "utf8"), "utf8");
  await writeFile(assetPath, "post-staple-dmg", "utf8");
  const refreshed = await refreshMacosManifestAsset({
    arch: "x64",
    assetPath,
    inputPath,
    outputPath: inputPath,
    version: "1.2.3",
  });
  const digest = await hashRegularFile(assetPath);
  const entry = refreshed.files.find(({ url }) => url === path.basename(assetPath));
  assert.equal(entry.sha512, digest.sha512);
  assert.equal(entry.size, digest.size);
  assert.equal(refreshed.path, "Termous-1.2.3-macos-x64.zip");
  assert.notEqual(refreshed.sha512, digest.sha512);
});

test("严格 YAML 解析拒绝重复 key", async () => {
  const invalid = await readFile(
    path.join(fixtureDirectory, "invalid-duplicate-key.yml"),
    "utf8",
  );
  assert.throws(
    () => parseUpdateManifestText(invalid, "invalid.yml"),
    /YAML 无效/u,
  );
});

test("合并拒绝版本冲突和共同字段冲突", async (t) => {
  const directory = await temporaryDirectory(t);
  const arm64 = parseUpdateManifestText(await readFile(arm64Fixture, "utf8"));
  const versionConflict = await writeManifest(directory, "version.yml", {
    ...arm64,
    version: "1.2.4",
  });
  await assert.rejects(
    mergeMacosUpdateInfo({
      arm64Path: versionConflict,
      outputPath: path.join(directory, "version-output.yml"),
      version: "1.2.3",
      x64Path: x64Fixture,
    }),
    /版本冲突/u,
  );
  const fieldConflict = await writeManifest(directory, "field.yml", {
    ...arm64,
    releaseName: "另一个版本名称",
  });
  await assert.rejects(
    mergeMacosUpdateInfo({
      arm64Path: fieldConflict,
      outputPath: path.join(directory, "field-output.yml"),
      version: "1.2.3",
      x64Path: x64Fixture,
    }),
    /共同字段不一致/u,
  );
});

test("合并拒绝缺架构载荷、绝对 URL 和重复 URL", async (t) => {
  const directory = await temporaryDirectory(t);
  const x64 = parseUpdateManifestText(await readFile(x64Fixture, "utf8"));
  const missing = await writeManifest(directory, "missing.yml", {
    ...x64,
    files: x64.files.slice(0, 1),
  });
  await assert.rejects(
    normalizeMacosPartial({
      arch: "x64",
      inputPath: missing,
      outputPath: path.join(directory, "missing-output.yml"),
      version: "1.2.3",
    }),
    /缺少预期载荷/u,
  );
  const absoluteUrl = await writeManifest(directory, "absolute.yml", {
    ...x64,
    files: [
      { ...x64.files[0], url: "https://example.invalid/update.zip" },
      x64.files[1],
    ],
    path: "https://example.invalid/update.zip",
  });
  await assert.rejects(
    normalizeMacosPartial({
      arch: "x64",
      inputPath: absoluteUrl,
      outputPath: path.join(directory, "absolute-output.yml"),
      version: "1.2.3",
    }),
    /安全的单层文件名/u,
  );
  const duplicate = await writeManifest(directory, "duplicate.yml", {
    ...x64,
    files: [x64.files[0], { ...x64.files[1], url: x64.files[0].url }],
  });
  await assert.rejects(
    normalizeMacosPartial({
      arch: "x64",
      inputPath: duplicate,
      outputPath: path.join(directory, "duplicate-output.yml"),
      version: "1.2.3",
    }),
    /重复 URL/u,
  );
});

test("releaseDate 不一致时必须显式归一化", async (t) => {
  const directory = await temporaryDirectory(t);
  const arm64 = parseUpdateManifestText(await readFile(arm64Fixture, "utf8"));
  const changed = await writeManifest(directory, "changed-date.yml", {
    ...arm64,
    releaseDate: "2026-07-25T00:01:00.000Z",
  });
  await assert.rejects(
    mergeMacosUpdateInfo({
      arm64Path: changed,
      outputPath: path.join(directory, "rejected.yml"),
      version: "1.2.3",
      x64Path: x64Fixture,
    }),
    /显式传入 --release-date/u,
  );
  const result = await mergeMacosUpdateInfo({
    arm64Path: changed,
    outputPath: path.join(directory, "accepted.yml"),
    releaseDate: "2026-07-25T00:02:00.000Z",
    version: "1.2.3",
    x64Path: x64Fixture,
  });
  assert.equal(result.releaseDate, "2026-07-25T00:02:00.000Z");
});
