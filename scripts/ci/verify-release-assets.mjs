import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadReleaseVerificationSource } from "./release-asset-source.mjs";
import { verifyReleaseAssets } from "./release-assets-verifier.mjs";
import {
  createAssetReceipt,
  stringifyAssetReceipt,
} from "./release-receipt.mjs";

function parseArguments(argv) {
  const command = argv[0];
  if (command !== "receipt" && command !== "verify") {
    throw new Error("第一个参数必须是 receipt 或 verify");
  }
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
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

async function runReceipt(values) {
  const version = takeRequired(values, "--version");
  const platform = takeRequired(values, "--platform");
  const arch = takeRequired(values, "--arch");
  const assetPath = takeRequired(values, "--asset");
  const outputPath = takeRequired(values, "--output");
  const signature = takeRequired(values, "--signature");
  const manifestPath = takeOptional(values, "--manifest");
  assertNoUnknownArguments(values);
  const expectedOutput = `${path.basename(assetPath)}.receipt.json`;
  if (path.basename(outputPath) !== expectedOutput) {
    throw new Error(`receipt 输出文件名必须是 ${expectedOutput}`);
  }
  const receipt = await createAssetReceipt({
    arch,
    assetPath,
    manifestPath,
    platform,
    signature,
    version,
  });
  await writeAtomic(outputPath, stringifyAssetReceipt(receipt));
  console.log(
    JSON.stringify({
      asset: receipt.asset,
      output: path.resolve(outputPath),
      sha256: receipt.sha256,
      size: receipt.size,
    }),
  );
}

async function runVerify(values) {
  const version = takeRequired(values, "--version");
  const tag = takeRequired(values, "--tag");
  const phase = takeRequired(values, "--phase");
  const releaseJsonPath = takeOptional(values, "--release-json");
  const assetsDirectory = takeOptional(values, "--assets-dir");
  const githubRepository = takeOptional(values, "--github-repository");
  const tokenEnvironment = takeOptional(values, "--token-env");
  assertNoUnknownArguments(values);
  const source = await loadReleaseVerificationSource({
    assetsDirectory,
    githubRepository,
    githubTag: tag,
    releaseJsonPath,
    tokenEnvironment,
  });
  try {
    const result = await verifyReleaseAssets({
      assetsDirectory: source.assetsDirectory,
      phase,
      release: source.release,
      tag,
      version,
    });
    console.log(JSON.stringify({ ...result, source: source.mode }));
  } finally {
    await source.cleanup();
  }
}

async function main(argv) {
  const { command, values } = parseArguments(argv);
  if (command === "receipt") {
    await runReceipt(values);
    return;
  }
  await runVerify(values);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `Release 资产处理失败: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
