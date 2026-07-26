import { createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  requireSafeAssetName,
  resolveAssetFile,
} from "./release-manifest-contract.mjs";

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value;
}

function parseReleaseJson(text, source) {
  try {
    return requireRecord(JSON.parse(text), `${source} 根节点`);
  } catch (error) {
    throw new Error(
      `${source} JSON 无效: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function ensureRegularJsonFile(filePath) {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${filePath} 必须是普通 JSON 文件`);
  }
}

function requireGithubRepository(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
  ) {
    throw new Error(`GitHub repository 格式无效: ${String(value)}`);
  }
  return value;
}

function requireGithubTag(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^v?[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value)
  ) {
    throw new Error(`GitHub tag 格式无效: ${String(value)}`);
  }
  return value;
}

function githubHeaders(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": "termous-release-contract",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

const RELEASES_PER_PAGE = 100;
const MAX_RELEASE_PAGES = 10;

async function requireSuccessfulResponse(response, label) {
  if (!response?.ok) {
    throw new Error(`${label}失败，HTTP 状态: ${String(response?.status)}`);
  }
  return response;
}

async function fetchGithubRelease({
  fetchImpl,
  repository,
  tag,
  token,
}) {
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const endpoint = new URL(
      `https://api.github.com/repos/${repository}/releases`,
    );
    endpoint.searchParams.set("per_page", String(RELEASES_PER_PAGE));
    endpoint.searchParams.set("page", String(page));
    const response = await requireSuccessfulResponse(
      await fetchImpl(endpoint, {
        headers: githubHeaders(token),
        redirect: "error",
      }),
      "读取 GitHub Releases",
    );
    const releases = await response.json();
    if (!Array.isArray(releases)) {
      throw new Error("GitHub Releases API 响应必须是数组");
    }
    const matches = releases.filter(
      (release) =>
        release !== null &&
        typeof release === "object" &&
        !Array.isArray(release) &&
        release.tag_name === tag,
    );
    if (matches.length > 1) {
      throw new Error(`GitHub Releases 中存在重复 Tag: ${tag}`);
    }
    if (matches.length === 1) {
      return requireRecord(matches[0], "GitHub Release API 响应");
    }
    if (releases.length < RELEASES_PER_PAGE) {
      break;
    }
  }
  throw new Error(`GitHub Releases 中未找到 Tag: ${tag}`);
}

function resolveGithubAccess({
  githubRepository,
  githubTag,
  tokenEnvironment,
}) {
  const repository = requireGithubRepository(githubRepository);
  const tag = requireGithubTag(githubTag);
  if (
    typeof tokenEnvironment !== "string" ||
    !/^[A-Z_][A-Z0-9_]*$/.test(tokenEnvironment)
  ) {
    throw new Error("GitHub 模式必须通过 --token-env 显式指定 Token 环境变量名");
  }
  const token = process.env[tokenEnvironment];
  if (!token) {
    throw new Error(`环境变量 ${tokenEnvironment} 未提供 GitHub Token`);
  }
  return { repository, tag, token };
}

export async function fetchGithubReleaseByTag(
  options,
  { fetchImpl = globalThis.fetch } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node.js 环境不支持 fetch");
  }
  const access = resolveGithubAccess(options);
  return fetchGithubRelease({ ...access, fetchImpl });
}

async function downloadGithubAsset({
  asset,
  directory,
  fetchImpl,
  repository,
  token,
}) {
  const assetRecord = requireRecord(asset, "GitHub Release asset");
  const name = requireSafeAssetName(assetRecord.name, "GitHub Release asset.name");
  const apiUrl = new URL(assetRecord.url);
  const [owner, repo] = repository.split("/");
  const pathSegments = apiUrl.pathname.split("/");
  if (
    apiUrl.protocol !== "https:" ||
    apiUrl.hostname !== "api.github.com" ||
    apiUrl.search !== "" ||
    apiUrl.hash !== "" ||
    pathSegments.length !== 7 ||
    pathSegments[1] !== "repos" ||
    pathSegments[2].toLowerCase() !== owner.toLowerCase() ||
    pathSegments[3].toLowerCase() !== repo.toLowerCase() ||
    pathSegments[4] !== "releases" ||
    pathSegments[5] !== "assets" ||
    !/^[1-9][0-9]*$/.test(pathSegments[6])
  ) {
    throw new Error(`GitHub Release asset API URL 不可信: ${apiUrl.href}`);
  }
  const response = await requireSuccessfulResponse(
    await fetchImpl(apiUrl, {
      headers: githubHeaders(token, "application/octet-stream"),
      redirect: "follow",
    }),
    `下载 ${name}`,
  );
  if (!response.body) {
    throw new Error(`下载 ${name} 未返回响应体`);
  }
  const targetPath = resolveAssetFile(directory, name);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(targetPath, { flags: "wx" }),
    );
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function loadLocalSource({ assetsDirectory, releaseJsonPath }) {
  if (!assetsDirectory || !releaseJsonPath) {
    throw new Error("离线模式必须同时提供 --release-json 和 --assets-dir");
  }
  await ensureRegularJsonFile(releaseJsonPath);
  const release = parseReleaseJson(
    await readFile(releaseJsonPath, "utf8"),
    path.basename(releaseJsonPath),
  );
  return {
    assetsDirectory: path.resolve(assetsDirectory),
    cleanup: async () => undefined,
    mode: "offline",
    release,
  };
}

async function loadGithubSource(
  {
    assetsDirectory,
    githubRepository,
    githubTag,
    tokenEnvironment,
  },
  fetchImpl,
) {
  const { repository, tag, token } = resolveGithubAccess({
    githubRepository,
    githubTag,
    tokenEnvironment,
  });
  const release = await fetchGithubRelease({
    fetchImpl,
    repository,
    tag,
    token,
  });
  if (!Array.isArray(release.assets)) {
    throw new Error("GitHub Release API 响应缺少 assets");
  }
  const temporary = !assetsDirectory;
  const directory = temporary
    ? await mkdtemp(path.join(os.tmpdir(), "termous-release-assets-"))
    : path.resolve(assetsDirectory);
  if (!temporary) {
    await mkdir(directory, { recursive: true });
  }
  try {
    for (const asset of release.assets) {
      await downloadGithubAsset({
        asset,
        directory,
        fetchImpl,
        repository,
        token,
      });
    }
  } catch (error) {
    if (temporary) {
      await rm(directory, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
  return {
    assetsDirectory: directory,
    cleanup: temporary
      ? async () => rm(directory, { force: true, recursive: true })
      : async () => undefined,
    mode: "github",
    release,
  };
}

export async function loadReleaseVerificationSource(
  options,
  { fetchImpl = globalThis.fetch } = {},
) {
  const hasGithub = options.githubRepository !== undefined;
  const hasLocal =
    options.releaseJsonPath !== undefined || options.assetsDirectory !== undefined;
  if (hasGithub && options.releaseJsonPath !== undefined) {
    throw new Error("不能同时使用 GitHub 模式和离线 release JSON");
  }
  if (!hasGithub) {
    return loadLocalSource(options);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node.js 环境不支持 fetch");
  }
  if (!options.githubTag) {
    throw new Error("GitHub 模式必须显式提供 --github-tag");
  }
  if (hasLocal && options.releaseJsonPath !== undefined) {
    throw new Error("GitHub 模式不接受 --release-json");
  }
  return loadGithubSource(options, fetchImpl);
}
