import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modules = { remote: "termous/remote", rdp: "termous/rdp" };
const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+incompatible)?$/u;
const pseudoVersionPattern = /^v\d+\.(?:0\.0-|\d+\.\d+-(?:[^+]*\.)?0\.)\d{14}-([0-9a-f]{12})(?:\+incompatible)?$/u;

export function dependencyRefs(manifest) {
  return Object.entries(modules).map(([name, modulePath]) => {
    const required = manifest.Require?.find(({ Path }) => Path === modulePath);
    if (!required) throw new Error(`Core 缺少直接依赖 ${modulePath}`);
    const replacements = (manifest.Replace ?? []).filter(({ Old }) => Old.Path === modulePath);
    const replacement = replacements.find(({ Old }) => Old.Version === required.Version)
      ?? replacements.find(({ Old }) => !Old.Version);
    const target = replacement?.New;
    const repository = /^github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u.exec(target?.Path ?? "")?.[1];
    const version = target?.Version ?? "";
    const parsed = versionPattern.exec(version);
    if (!repository || !parsed || parsed[4]?.split(".").some(part => /^0\d+$/u.test(part))) {
      throw new Error(`${modulePath} 必须替换为 GitHub 仓库根模块的固定 Go 版本`);
    }
    const pseudoHash = pseudoVersionPattern.exec(version)?.[1];
    return {
      name, repository, version,
      ref: pseudoHash ?? `refs/tags/${version.replace(/\+incompatible$/u, "")}`,
      pseudoHash,
    };
  });
}

export function resolveDependencies(manifest, resolveCommit) {
  const outputs = {};
  for (const dependency of dependencyRefs(manifest)) {
    const sha = resolveCommit(dependency.repository, dependency.ref).trim();
    if (!/^[0-9a-f]{40}$/u.test(sha) || (dependency.pseudoHash && !sha.startsWith(dependency.pseudoHash))) {
      throw new Error(`${dependency.repository}@${dependency.version} 未解析到匹配的完整提交`);
    }
    outputs[`${dependency.name}_repository`] = dependency.repository;
    outputs[`${dependency.name}_sha`] = sha;
  }
  return outputs;
}

function main() {
  const coreDir = process.argv[2];
  if (!coreDir || !process.env.GITHUB_OUTPUT) {
    throw new Error("需要 Core 目录参数和 GITHUB_OUTPUT");
  }
  const manifest = JSON.parse(execFileSync("go", ["mod", "edit", "-json"], {
    cwd: resolve(coreDir), encoding: "utf8", timeout: 30_000,
    env: { ...process.env, GOWORK: "off" },
  }));
  const outputs = resolveDependencies(manifest, (repository, ref) => execFileSync("gh", [
    "api", `repos/${repository}/commits/${encodeURIComponent(ref)}`, "--jq", ".sha",
  ], { encoding: "utf8", timeout: 60_000 }));
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs)
    .map(([name, value]) => `${name}=${value}\n`).join(""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
