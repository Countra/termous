import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const maximumAgentWorkerBundleBytes = 1280 * 1024

const requiredProviderAdapters = Object.freeze([
  'openai-completions.js',
  'openai-responses.js',
])

const allowedPiAPIModules = new Set([
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
  'zod',
])

export async function checkAgentWorkerBundle(filePath) {
  const info = await lstat(filePath)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
    throw new Error('Agent Worker 产物必须是非空普通文件')
  }
  if (info.size > maximumAgentWorkerBundleBytes) {
    throw new Error(
      `Agent Worker 产物 ${info.size} bytes 超过 ${maximumAgentWorkerBundleBytes} bytes 上限`,
    )
  }

  const content = (await readFile(filePath, 'utf8')).replaceAll('\\', '/')
  assertRequiredProviderAdapters(content)
  assertAllowedPiAPIModules(content)
  assertForbiddenProviderSourcesAbsent(content)
  assertAllowedRuntimePackages(content)

  return info.size
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
