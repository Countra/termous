import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  parseUpdateManifestText,
  requireReleaseVersion,
  validateUpdateManifest,
} from "./release-manifest-contract.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const linuxFixturePath = path.join(
  currentDirectory,
  "fixtures",
  "release-contract",
  "latest-linux.appimage.yml",
);
const sha512 =
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==";

async function readLinuxFixture() {
  return parseUpdateManifestText(
    await readFile(linuxFixturePath, "utf8"),
    "latest-linux.yml",
  );
}

function createManifest(platform) {
  if (platform === "windows") {
    const url = "Termous-1.2.3-windows-x64-setup.exe";
    return {
      version: "1.2.3",
      files: [{ url, sha512, size: 1024, blockMapSize: 128 }],
      path: url,
      sha512,
    };
  }
  const zip = "Termous-1.2.3-macos-x64.zip";
  const dmg = "Termous-1.2.3-macos-x64.dmg";
  return {
    version: "1.2.3",
    files: [
      { url: zip, sha512, size: 1024, blockMapSize: 128 },
      { url: dmg, sha512, size: 2048 },
    ],
    path: zip,
    sha512,
  };
}

test("接受 electron-builder AppImage manifest 的 blockMapSize", async () => {
  const manifest = await readLinuxFixture();
  const result = validateUpdateManifest(manifest, {
    platform: "linux",
    source: "latest-linux.yml",
    version: "1.2.3",
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].blockMapSize, 98304);
});

test("Linux AppImage 必须提供正安全整数 blockMapSize", async () => {
  const manifest = await readLinuxFixture();
  const missing = structuredClone(manifest);
  delete missing.files[0].blockMapSize;
  assert.throws(
    () =>
      validateUpdateManifest(missing, {
        platform: "linux",
        version: "1.2.3",
      }),
    /blockMapSize.*正安全整数/u,
  );
  for (const invalid of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "98304",
    null,
  ]) {
    const candidate = structuredClone(manifest);
    candidate.files[0].blockMapSize = invalid;
    assert.throws(
      () =>
        validateUpdateManifest(candidate, {
          platform: "linux",
          version: "1.2.3",
        }),
      /blockMapSize.*正安全整数/u,
    );
  }
  const oversized = structuredClone(manifest);
  oversized.files[0].blockMapSize = oversized.files[0].size + 1;
  assert.throws(
    () =>
      validateUpdateManifest(oversized, {
        platform: "linux",
        version: "1.2.3",
      }),
    /blockMapSize 不能大于 AppImage size/u,
  );
});

test("Windows 与 macOS manifest 拒绝 blockMapSize", () => {
  for (const platform of ["windows", "macos"]) {
    assert.throws(
      () =>
        validateUpdateManifest(createManifest(platform), {
          arch: platform === "macos" ? "x64" : undefined,
          platform,
          version: "1.2.3",
        }),
      /blockMapSize 只允许用于 Linux AppImage/u,
    );
  }
});

test("发布版本拒绝 build metadata、歧义架构名和非规范数字", () => {
  for (const version of [
    "1.2.3+build.1",
    "1.2.3-arm64-test",
    "1.2.3-ARM64",
    "01.2.3",
    "1.2.3-01",
  ]) {
    assert.throws(() => requireReleaseVersion(version), /发布版本|arm64/u);
  }
  assert.equal(requireReleaseVersion("1.2.3-rc.1"), "1.2.3-rc.1");
});
