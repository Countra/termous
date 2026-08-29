import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  checkAgentWorkerBundle,
  maximumAgentWorkerBundleBytes,
} from './check-worker-bundle.mjs'

test('Agent Worker 产物门禁接受受控体积的普通文件', async (context) => {
  const directory = await temporaryDirectory(context)
  const bundlePath = path.join(directory, 'agent-worker.js')
  const content = validWorkerBundle()
  await writeFile(bundlePath, content)

  assert.equal(await checkAgentWorkerBundle(bundlePath), Buffer.byteLength(content))
})

test('Agent Worker 产物门禁拒绝超限文件', async (context) => {
  const directory = await temporaryDirectory(context)
  const oversizedPath = path.join(directory, 'oversized.js')
  await writeFile(oversizedPath, Buffer.alloc(maximumAgentWorkerBundleBytes + 1))
  await assert.rejects(checkAgentWorkerBundle(oversizedPath), /超过/u)
})

test('Agent Worker 产物门禁拒绝符号链接', async (context) => {
  const directory = await temporaryDirectory(context)
  const sourcePath = path.join(directory, 'source.js')
  const linkedPath = path.join(directory, 'linked.js')
  await writeFile(sourcePath, validWorkerBundle())
  try {
    await symlink(sourcePath, linkedPath, 'file')
  } catch (error) {
    if (process.platform === 'win32' && isWindowsSymlinkPermissionError(error)) {
      context.skip('当前 Windows 用户无创建符号链接权限')
      return
    }
    throw error
  }
  await assert.rejects(checkAgentWorkerBundle(linkedPath), /普通文件/u)
})

test('Agent Worker 产物门禁要求两种 OpenAI 适配器同时存在', async (context) => {
  const directory = await temporaryDirectory(context)
  const bundlePath = path.join(directory, 'agent-worker.js')
  await writeFile(
    bundlePath,
    piAPIModuleMarker('openai-completions.js'),
  )

  await assert.rejects(
    checkAgentWorkerBundle(bundlePath),
    /缺少必需模型适配器: openai-responses\.js/u,
  )
})

test('Agent Worker 产物门禁拒绝非目标 Provider 包', async (context) => {
  const directory = await temporaryDirectory(context)
  for (const packagePath of [
    'node_modules/@anthropic-ai/sdk/index.js',
    'node_modules/@aws-sdk/client-bedrock-runtime/index.js',
    'node_modules/@google/genai/index.js',
  ]) {
    const bundlePath = path.join(
      directory,
      `${packagePath.split('/')[2]}.js`,
    )
    await writeFile(bundlePath, `${validWorkerBundle()}\n${packagePath}`)
    await assert.rejects(checkAgentWorkerBundle(bundlePath), /非目标 Provider/u)
  }
})

test('Agent Worker 产物门禁拒绝未审核的 pi API 与 Provider 模块', async (context) => {
  const directory = await temporaryDirectory(context)
  const apiBundlePath = path.join(directory, 'api.js')
  await writeFile(
    apiBundlePath,
    `${validWorkerBundle()}\n${piAPIModuleMarker('anthropic.js')}`,
  )
  await assert.rejects(checkAgentWorkerBundle(apiBundlePath), /未授权的 pi API/u)

  const providerBundlePath = path.join(directory, 'provider.js')
  await writeFile(
    providerBundlePath,
    `${validWorkerBundle()}\n@earendil-works/pi-ai/dist/providers/anthropic.js`,
  )
  await assert.rejects(checkAgentWorkerBundle(providerBundlePath), /非目标 Provider/u)
})

test('Agent Worker 产物门禁拒绝未审核的运行时依赖', async (context) => {
  const directory = await temporaryDirectory(context)
  const bundlePath = path.join(directory, 'dependency.js')
  await writeFile(
    bundlePath,
    `${validWorkerBundle()}\n//#region node_modules/lodash/lodash.js`,
  )

  await assert.rejects(
    checkAgentWorkerBundle(bundlePath),
    /未授权运行时依赖: lodash/u,
  )
})

async function temporaryDirectory(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'termous-agent-worker-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function isWindowsSymlinkPermissionError(error) {
  return error instanceof Error && 'code' in error && error.code === 'EPERM'
}

function validWorkerBundle() {
  return [
    piAPIModuleMarker('openai-completions.js'),
    piAPIModuleMarker('openai-responses-shared.js'),
    piAPIModuleMarker('openai-responses.js'),
    piAPIModuleMarker('transform-messages.js'),
  ].join('\n')
}

function piAPIModuleMarker(moduleName) {
  return `//#region node_modules/@earendil-works/pi-ai/dist/api/${moduleName}`
}
