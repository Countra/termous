import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// pi 0.87.1 的完整依赖闭包约 1301 KiB，按 64 KiB 档位留出余量；Provider 白名单仍独立检查。
export const maximumAgentWorkerBundleBytes = 1344 * 1024

const requiredProviderAdapters = Object.freeze([
  'openai-completions.js',
  'openai-responses.js',
])

const allowedPiAPIModules = new Set([
  'lazy.js',
  'constrained-sampling.js',
  'github-copilot-headers.js',
  'openai-completions.js',
  'openai-responses-shared.js',
  'openai-responses.js',
  'simple-options.js',
  'transform-messages.js',
])

const forbiddenProviderSources = Object.freeze([
  'node_modules/@anthropic-ai/sdk/',
  'node_modules/@aws-sdk/client-bedrock-runtime/',
  'node_modules/@google/genai/',
  '@earendil-works/pi-ai/dist/providers/',
])

const allowedRuntimePackages = new Set([
  '@earendil-works/chord',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-telemetry',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/core',
  'diff',
  'eventsource-parser',
  'openai',
  'partial-json',
  'pkce-challenge',
  'typebox',
  // pi-agent-core 的公开入口保留了 Harness YAML 模块的初始化副作用。
  'yaml',
  'zod',
])

export async function checkAgentWorkerBundle(filePath) {
  const { content, size } = await readWorkerBundleGraph(filePath)
  assertRequiredProviderAdapters(content)
  assertAllowedPiAPIModules(content)
  assertForbiddenProviderSourcesAbsent(content)
  assertAllowedRuntimePackages(content)

  return size
}

// 多个 Worker 共享 Provider chunk 后，按真实本地依赖闭包校验，不能只检查入口文件。
async function readWorkerBundleGraph(filePath) {
  const directory = path.dirname(path.resolve(filePath))
  const pending = [path.resolve(filePath)]
  const visited = new Set()
  const contents = []
  let size = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (visited.has(current)) continue
    visited.add(current)
    const relative = path.relative(directory, current)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Worker chunk 超出产物目录')
    const info = await lstat(current)
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) throw new Error('Agent Worker 产物必须是非空普通文件')
    size += info.size
    if (size > maximumAgentWorkerBundleBytes) {
      throw new Error(`Agent Worker 产物 ${size} bytes 超过 ${maximumAgentWorkerBundleBytes} bytes 上限`)
    }
    const text = await readFile(current, 'utf8')
    contents.push(text.replaceAll('\\', '/'))
    const source = ts.createSourceFile(current, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const visit = (node) => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
        pending.push(path.resolve(path.dirname(current), specifier.text))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { content: contents.join('\n'), size }
}

function assertRequiredProviderAdapters(content) {
  for (const moduleName of requiredProviderAdapters) {
    const marker = `@earendil-works/pi-ai/dist/api/${moduleName}`
    if (!content.includes(marker)) {
      throw new Error(`Agent Worker 产物缺少必需模型适配器: ${moduleName}`)
    }
  }
}

function assertAllowedPiAPIModules(content) {
  const modulePattern = /@earendil-works\/pi-ai\/dist\/api\/([^\s"'`]+\.js)/gu
  const includedModules = new Set(
    [...content.matchAll(modulePattern)].map((match) => match[1]),
  )
  for (const moduleName of includedModules) {
    if (!allowedPiAPIModules.has(moduleName)) {
      throw new Error(`Agent Worker 产物包含未授权的 pi API 模块: ${moduleName}`)
    }
  }
}

function assertForbiddenProviderSourcesAbsent(content) {
  for (const source of forbiddenProviderSources) {
    if (content.includes(source)) {
      throw new Error(`Agent Worker 产物包含非目标 Provider: ${source}`)
    }
  }
}

function assertAllowedRuntimePackages(content) {
  const packagePattern = /(?:^|[\s/])node_modules\/(?:\.pnpm\/[^/\r\n]+\/node_modules\/)?((?:@[^/\r\n]+\/)?[^/\r\n]+)\//gmu
  const includedPackages = new Set(
    [...content.matchAll(packagePattern)].map((match) => match[1]),
  )
  for (const packageName of includedPackages) {
    if (!allowedRuntimePackages.has(packageName)) {
      throw new Error(`Agent Worker 产物包含未授权运行时依赖: ${packageName}`)
    }
  }
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const webDirectory = path.resolve(scriptDirectory, '..', '..')
  const bundlePath = path.join(webDirectory, 'dist-electron', 'agent-worker.js')
  const size = await checkAgentWorkerBundle(bundlePath)
  console.log(`Agent Worker 产物检查通过: ${size} bytes`)
  const completionSize = await checkAgentWorkerBundle(path.join(webDirectory, 'dist-electron', 'terminal-completion-worker.js'))
  console.log(`Terminal Completion Worker 产物检查通过: ${completionSize} bytes`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
