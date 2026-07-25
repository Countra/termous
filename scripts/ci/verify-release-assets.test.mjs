import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadReleaseVerificationSource } from "./release-asset-source.mjs";
import {
  createReleaseContentFingerprint,
  createReleaseSnapshotFingerprint,
  verifyReleaseAssets,
} from "./release-assets-verifier.mjs";
import {
  expectedReleaseContract,
  hashRegularFile,
  stringifyUpdateManifest,
} from "./release-manifest-contract.mjs";
import {
  createAssetReceipt,
  stringifyAssetReceipt,
} from "./release-receipt.mjs";

const VERSION = "1.2.3";
const TAG = `v${VERSION}`;

async function createTemporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "termous-release-fixture-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const assetsDirectory = path.join(root, "assets");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(assetsDirectory, { recursive: true }),
  );
  return { assetsDirectory, root };
}

async function writeManifest(assetsDirectory, name, entries) {
  const legacyEntry =
    entries.find(({ url }) => url.includes("-x64.") && url.endsWith(".zip")) ??
    entries[0];
  await writeFile(
    path.join(assetsDirectory, name),
    stringifyUpdateManifest({
      version: VERSION,
      files: entries,
      path: legacyEntry.url,
      sha512: legacyEntry.sha512,
      releaseDate: "2026-07-25T00:00:00.000Z",
    }),
    "utf8",
  );
}

async function createReleaseFixture(t) {
  const { assetsDirectory, root } = await createTemporaryRoot(t);
  const contract = expectedReleaseContract(VERSION);
  for (const target of contract.receiptTargets) {
    await writeFile(
      path.join(assetsDirectory, target.name),
      `fixture:${target.name}:content`,
      "utf8",
    );
  }
  const payloadDigests = new Map();
  for (const payload of contract.payloads) {
    payloadDigests.set(
      payload.name,
      await hashRegularFile(path.join(assetsDirectory, payload.name)),
    );
  }
  const windowsPayloads = contract.payloads.filter(
    ({ platform }) => platform === "windows",
  );
  const linuxPayloads = contract.payloads.filter(
    ({ platform }) => platform === "linux",
  );
  const macosPayloads = contract.payloads.filter(
    ({ platform }) => platform === "macos",
  );
  const entries = (payloads, { linux = false } = {}) =>
    payloads.map(({ name }) => ({
      url: name,
      sha512: payloadDigests.get(name).sha512,
      size: payloadDigests.get(name).size,
      ...(linux ? { blockMapSize: 1 } : {}),
    }));
  await writeManifest(
    assetsDirectory,
    "latest.yml",
    entries(windowsPayloads),
  );
  await writeManifest(
    assetsDirectory,
    "latest-linux.yml",
    entries(linuxPayloads, { linux: true }),
  );
  await writeManifest(
    assetsDirectory,
    "latest-mac.yml",
    entries(macosPayloads),
  );
  for (const target of contract.receiptTargets) {
    if (target.platform === "macos" && target.manifest !== null) {
      await writeManifest(
        assetsDirectory,
        "latest-mac.yml",
        entries(macosPayloads.filter(({ arch }) => arch === target.arch)),
      );
    }
    const receipt = await createAssetReceipt({
      arch: target.arch,
      assetPath: path.join(assetsDirectory, target.name),
      manifestPath:
        target.manifest === null
          ? undefined
          : path.join(assetsDirectory, target.manifest),
      platform: target.platform,
      signature: target.signature,
      version: VERSION,
    });
    await writeFile(
      path.join(assetsDirectory, `${target.name}.receipt.json`),
      stringifyAssetReceipt(receipt),
      "utf8",
    );
  }
  await writeManifest(
    assetsDirectory,
    "latest-mac.yml",
    entries(macosPayloads),
  );
  return { assetsDirectory, contract, root };
}

async function releaseFromDirectory(
  assetsDirectory,
  { missingDigest = new Set() } = {},
) {
  const names = (await readdir(assetsDirectory)).sort();
  const assets = [];
  for (const name of names) {
    const digest = await hashRegularFile(path.join(assetsDirectory, name));
    assets.push({
      browser_download_url: `https://github.com/Countra/termous/releases/download/${TAG}/${name}`,
      digest: missingDigest.has(name) ? null : `sha256:${digest.sha256}`,
      name,
      size: digest.size,
      url: `https://api.github.com/repos/Countra/termous/releases/assets/${assets.length + 1}`,
    });
  }
  return {
    assets,
    body: "Release fixture notes",
    draft: true,
    prerelease: false,
    tag_name: TAG,
  };
}

async function removeReceipts(assetsDirectory, contract) {
  for (const receipt of contract.receipts) {
    await unlink(path.join(assetsDirectory, receipt));
  }
}

test("离线 receipt 阶段验证全部平台载荷、sidecar 和摘要", async (t) => {
  const fixture = await createReleaseFixture(t);
  const fallbackAsset = `Termous-${VERSION}-linux-x64.AppImage`;
  const result = await verifyReleaseAssets({
    assetsDirectory: fixture.assetsDirectory,
    phase: "receipts",
    release: await releaseFromDirectory(fixture.assetsDirectory, {
      missingDigest: new Set([fallbackAsset]),
    }),
    tag: TAG,
    version: VERSION,
  });
  assert.equal(result.phase, "receipts");
  assert.match(result.contentFingerprint, /^[a-f0-9]{64}$/u);
  assert.match(result.releaseFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(result.fallbackDigestCount, 1);
  assert.equal(
    result.assetCount,
    fixture.contract.finalAssets.length + fixture.contract.receipts.length,
  );
});

test("清理后 final 阶段拒绝 partial 和 receipt", async (t) => {
  const fixture = await createReleaseFixture(t);
  await removeReceipts(fixture.assetsDirectory, fixture.contract);
  const result = await verifyReleaseAssets({
    assetsDirectory: fixture.assetsDirectory,
    phase: "after-cleanup",
    release: await releaseFromDirectory(fixture.assetsDirectory),
    tag: TAG,
    version: VERSION,
  });
  assert.equal(result.phase, "final");
  const partialName = fixture.contract.partials[0];
  await writeFile(
    path.join(fixture.assetsDirectory, partialName),
    "version: 1.2.3\n",
    "utf8",
  );
  await assert.rejects(
    verifyReleaseAssets({
      assetsDirectory: fixture.assetsDirectory,
      phase: "final",
      release: await releaseFromDirectory(fixture.assetsDirectory),
      tag: TAG,
      version: VERSION,
    }),
    /仍包含 macOS partial/u,
  );
});

test("receipt 阶段拒绝缺失 receipt 和重复 Release 资产", async (t) => {
  const fixture = await createReleaseFixture(t);
  await unlink(
    path.join(fixture.assetsDirectory, fixture.contract.receipts[0]),
  );
  await assert.rejects(
    verifyReleaseAssets({
      assetsDirectory: fixture.assetsDirectory,
      phase: "pre-cleanup",
      release: await releaseFromDirectory(fixture.assetsDirectory),
      tag: TAG,
      version: VERSION,
    }),
    /缺少资产/u,
  );
  const restored = await createReleaseFixture(t);
  const release = await releaseFromDirectory(restored.assetsDirectory);
  release.assets.push({ ...release.assets[0] });
  await assert.rejects(
    verifyReleaseAssets({
      assetsDirectory: restored.assetsDirectory,
      phase: "receipts",
      release,
      tag: TAG,
      version: VERSION,
    }),
    /重复资产名/u,
  );
});

test("相同 size 的错误内容不能通过摘要和 manifest 门禁", async (t) => {
  const fixture = await createReleaseFixture(t);
  const target = `Termous-${VERSION}-linux-x64.AppImage`;
  const targetPath = path.join(fixture.assetsDirectory, target);
  const original = await readFile(targetPath, "utf8");
  const release = await releaseFromDirectory(fixture.assetsDirectory, {
    missingDigest: new Set([target]),
  });
  await writeFile(targetPath, "x".repeat(original.length), "utf8");
  await assert.rejects(
    verifyReleaseAssets({
      assetsDirectory: fixture.assetsDirectory,
      phase: "receipts",
      release,
      tag: TAG,
      version: VERSION,
    }),
    /SHA512|摘要/u,
  );
});

test("错误 API SHA256 即使 size 正确也会失败", async (t) => {
  const fixture = await createReleaseFixture(t);
  const release = await releaseFromDirectory(fixture.assetsDirectory);
  release.assets[0].digest = `sha256:${"0".repeat(64)}`;
  await assert.rejects(
    verifyReleaseAssets({
      assetsDirectory: fixture.assetsDirectory,
      phase: "receipts",
      release,
      tag: TAG,
      version: VERSION,
    }),
    /GitHub SHA256 digest/u,
  );
});

test("Release metadata 必须是同版本 Draft 且包含说明", async (t) => {
  const fixture = await createReleaseFixture(t);
  const release = await releaseFromDirectory(fixture.assetsDirectory);
  await assert.rejects(
    verifyReleaseAssets({
      assetsDirectory: fixture.assetsDirectory,
      phase: "receipts",
      release: { ...release, draft: false },
      tag: TAG,
      version: VERSION,
    }),
    /必须保持 Draft/u,
  );
  await assert.rejects(
    verifyReleaseAssets({
      assetsDirectory: fixture.assetsDirectory,
      phase: "receipts",
      release: { ...release, body: " " },
      tag: TAG,
      version: VERSION,
    }),
    /Release notes 不能为空/u,
  );
});

test("Release 快照指纹覆盖资产身份与可变元数据", async (t) => {
  const fixture = await createReleaseFixture(t);
  const release = await releaseFromDirectory(fixture.assetsDirectory);
  const original = createReleaseSnapshotFingerprint(release);
  const changedAsset = structuredClone(release);
  changedAsset.assets[0].url =
    "https://api.github.com/repos/Countra/termous/releases/assets/999999";
  assert.notEqual(createReleaseSnapshotFingerprint(changedAsset), original);
  assert.notEqual(
    createReleaseSnapshotFingerprint({ ...release, body: "Changed notes" }),
    original,
  );
});

test("Release 内容指纹覆盖最终载荷的双摘要", () => {
  const entries = [
    {
      name: "asset.bin",
      sha256: "1".repeat(64),
      sha512: "AQ==",
      size: 1,
    },
  ];
  const original = createReleaseContentFingerprint(entries);
  assert.match(original, /^[a-f0-9]{64}$/u);
  assert.notEqual(
    createReleaseContentFingerprint([
      { ...entries[0], sha512: "Ag==" },
    ]),
    original,
  );
});

test("离线 source 不访问网络，并接受 gh api Release JSON", async (t) => {
  const fixture = await createReleaseFixture(t);
  const releaseJsonPath = path.join(fixture.root, "release.json");
  await writeFile(
    releaseJsonPath,
    JSON.stringify(await releaseFromDirectory(fixture.assetsDirectory)),
    "utf8",
  );
  let fetchCalls = 0;
  const source = await loadReleaseVerificationSource(
    {
      assetsDirectory: fixture.assetsDirectory,
      releaseJsonPath,
    },
    {
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("离线测试不允许网络");
      },
    },
  );
  assert.equal(source.mode, "offline");
  assert.equal(fetchCalls, 0);
  await source.cleanup();
});

test("GitHub source 拒绝跨仓库 Release Asset API URL", async (t) => {
  const { assetsDirectory } = await createTemporaryRoot(t);
  const tokenName = "TERMOUS_RELEASE_TEST_TOKEN";
  const previousToken = process.env[tokenName];
  process.env[tokenName] = "fixture-token";
  t.after(() => {
    if (previousToken === undefined) {
      delete process.env[tokenName];
    } else {
      process.env[tokenName] = previousToken;
    }
  });

  let fetchCalls = 0;
  await assert.rejects(
    loadReleaseVerificationSource(
      {
        assetsDirectory,
        githubRepository: "Countra/termous",
        githubTag: TAG,
        tokenEnvironment: tokenName,
      },
      {
        fetchImpl: async () => {
          fetchCalls += 1;
          return {
            ok: true,
            json: async () => ({
              assets: [
                {
                  name: `Termous-${VERSION}-linux-x64.AppImage`,
                  url: "https://api.github.com/repos/other/repository/releases/assets/1",
                },
              ],
            }),
          };
        },
      },
    ),
    /API URL 不可信/u,
  );
  assert.equal(fetchCalls, 1);
});
