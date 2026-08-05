import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "../..");
const defaultAllowlistPath = path.join(
  scriptDirectory,
  "legacy-css-allowlist.json",
);

const comparePaths = (left, right) => left.localeCompare(right, "en");
const toPosix = (value) => value.replaceAll(path.sep, "/");
const styleExtensions = [".css", ".sass", ".scss"];

function classifyStyleFile(filePath) {
  const lowerPath = filePath.toLowerCase();
  const extension = styleExtensions.find((candidate) =>
    lowerPath.endsWith(candidate),
  );
  if (!extension) {
    return null;
  }
  return {
    extension,
    hasCanonicalExtension: filePath.endsWith(extension),
  };
}

function collectSourceFiles(directory, projectRoot, inventory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`样式源码目录不存在：${directory}`);
  }

  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => comparePaths(left.name, right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = toPosix(path.relative(projectRoot, entryPath));
    if (entry.isSymbolicLink()) {
      inventory.symbolicLinks.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      collectSourceFiles(entryPath, projectRoot, inventory);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const styleFile = classifyStyleFile(relativePath);
    if (!styleFile) {
      continue;
    }
    if (!styleFile.hasCanonicalExtension) {
      inventory.invalidExtensionCaseFiles.push(relativePath);
      continue;
    }
    if (styleFile.extension === ".css") {
      inventory.legacyCssFiles.push(relativePath);
    } else if (styleFile.extension === ".sass") {
      inventory.unsupportedSassFiles.push(relativePath);
    } else if (
      !relativePath.endsWith(".module.scss") &&
      !relativePath.startsWith("src/shared/styles/")
    ) {
      inventory.unscopedScssFiles.push(relativePath);
    }
  }
}

function readAllowlist(allowlistPath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 legacy CSS 清单：${detail}`, { cause: error });
  }

  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.legacyCssFiles)
  ) {
    throw new Error(
      "legacy CSS 清单格式无效：需要 schemaVersion=1 和 legacyCssFiles 数组。",
    );
  }

  const entries = value.legacyCssFiles;
  for (const entry of entries) {
    if (
      typeof entry !== "string" ||
      entry.includes("\\") ||
      path.posix.isAbsolute(entry) ||
      path.posix.normalize(entry) !== entry ||
      !entry.startsWith("src/") ||
      !entry.endsWith(".css")
    ) {
      throw new Error(`legacy CSS 清单包含无效路径：${String(entry)}`);
    }
  }

  if (new Set(entries).size !== entries.length) {
    throw new Error("legacy CSS 清单包含重复路径。");
  }

  const sortedEntries = [...entries].sort(comparePaths);
  if (entries.some((entry, index) => entry !== sortedEntries[index])) {
    throw new Error("legacy CSS 清单必须按路径字典序排列。");
  }

  return entries;
}

export function inspectLegacyCssAllowlist({
  projectRoot = defaultProjectRoot,
  allowlistPath = defaultAllowlistPath,
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const inventory = {
    invalidExtensionCaseFiles: [],
    legacyCssFiles: [],
    symbolicLinks: [],
    unscopedScssFiles: [],
    unsupportedSassFiles: [],
  };
  const sourceDirectory = path.join(resolvedProjectRoot, "src");
  if (fs.existsSync(sourceDirectory) && fs.lstatSync(sourceDirectory).isSymbolicLink()) {
    inventory.symbolicLinks.push("src");
  } else {
    collectSourceFiles(sourceDirectory, resolvedProjectRoot, inventory);
  }
  for (const files of Object.values(inventory)) {
    files.sort(comparePaths);
  }
  const actualFiles = inventory.legacyCssFiles;
  const allowlistedFiles = readAllowlist(path.resolve(allowlistPath));
  const actualSet = new Set(actualFiles);
  const allowlistedSet = new Set(allowlistedFiles);

  return {
    ...inventory,
    actualFiles,
    allowlistedFiles,
    unexpectedFiles: actualFiles.filter((file) => !allowlistedSet.has(file)),
    staleEntries: allowlistedFiles.filter((file) => !actualSet.has(file)),
  };
}

export function assertLegacyCssAllowlist(options) {
  const result = inspectLegacyCssAllowlist(options);
  const problems = [];

  if (result.unexpectedFiles.length > 0) {
    problems.push(
      `发现未登记的 legacy CSS：\n${result.unexpectedFiles
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }
  if (result.staleEntries.length > 0) {
    problems.push(
      `清单包含已经删除或迁移的 CSS：\n${result.staleEntries
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }
  if (result.unscopedScssFiles.length > 0) {
    problems.push(
      `业务样式必须使用 *.module.scss；非 Module SCSS 只能放在 src/shared/styles：\n${result.unscopedScssFiles
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }
  if (result.unsupportedSassFiles.length > 0) {
    problems.push(
      `不支持 .sass，请统一使用 SCSS：\n${result.unsupportedSassFiles
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }
  if (result.invalidExtensionCaseFiles.length > 0) {
    problems.push(
      `样式扩展名必须使用小写：\n${result.invalidExtensionCaseFiles
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }
  if (result.symbolicLinks.length > 0) {
    problems.push(
      `src 内不允许符号链接：\n${result.symbolicLinks
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `legacy CSS 清单校验失败。新增样式必须使用 SCSS；迁移旧样式时需同步收口清单。\n${problems.join("\n")}`,
    );
  }

  return result;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const result = assertLegacyCssAllowlist();
    console.log(`legacy CSS 清单校验通过：${result.actualFiles.length} 个文件。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
