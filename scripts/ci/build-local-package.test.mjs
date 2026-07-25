import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stringify as stringifyYaml } from 'yaml'
import { hashRegularFile } from './release-manifest-contract.mjs'
import {
  createElectronBuilderArguments,
  runLocalPackage,
  sanitizePublishEnvironment,
  validatePackageArtifacts,
} from './build-local-package.mjs'

test('electron-builder 固定 GitHub 更新源并同时生成 macOS DMG 与 ZIP', async () => {
  const configPath = path.resolve('electron-builder.json5')
  const configText = await readFile(configPath, 'utf8')
  const config = JSON.parse(
    configText.replace(/^\s*\/\/[^\r\n]*(?:\r?\n)?/, ''),
  )

  assert.equal(config.electronUpdaterCompatibility, '>=2.16')
  assert.deepEqual(config.publish, [{
    provider: 'github',
    owner: 'Countra',
    repo: 'termous',
    channel: 'latest',
    publishAutoUpdate: true,
  }])
  assert.deepEqual(config.mac.target, ['dmg', 'zip'])
  assert.equal(config.mac.notarize, true)
  assert.equal(config.dmg.sign, false)
  assert.equal(
    config.mac.artifactName,
    '${productName}-${version}-macos-${arch}.${ext}',
  )
})

test('本地打包入口固定 publish never 且清除发布凭据', () => {
  const environment = sanitizePublishEnvironment({
    GH_TOKEN: 'secret',
    GITHUB_TOKEN: 'secret',
    AWS_ACCESS_KEY_ID: 'secret',
    CSC_LINK: 'signing-certificate',
    PATH: 'path',
  })
  assert.equal(environment.GH_TOKEN, undefined)
  assert.equal(environment.GITHUB_TOKEN, undefined)
  assert.equal(environment.AWS_ACCESS_KEY_ID, undefined)
  assert.equal(environment.CSC_LINK, 'signing-certificate')
  assert.equal(environment.PATH, 'path')

  const args = createElectronBuilderArguments({
    platform: 'darwin',
    arch: 'arm64',
    outputDirectory: '/tmp/termous',
    version: '1.2.3',
    requireSigning: true,
  })
  assert.deepEqual(args.slice(0, 7), [
    'exec',
    'electron-builder',
    '--mac',
    'dmg',
    'zip',
    '--arm64',
    '--config',
  ])
  assert.equal(args.includes('--config.forceCodeSigning=true'), true)
  assert.deepEqual(args.slice(-2), ['--publish', 'never'])
})

test('三平台产物门禁接受完整 manifest、载荷与 blockmap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-package-contract-'))
  try {
    for (const target of [
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'darwin', arch: 'arm64' },
    ]) {
      const outputDirectory = path.join(
        root,
        `${target.platform}-${target.arch}`,
      )
      await writeCompleteFixture({
        outputDirectory,
        version: '1.2.3',
        ...target,
      })
      const result = await validatePackageArtifacts({
        outputDirectory,
        version: '1.2.3',
        ...target,
      })
      assert.equal(result.appUpdatePaths.length, 1)
      assert.equal(result.corePaths.length, 1)
      assert.equal(result.files.length >= 2, true)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('产物门禁拒绝缺失 blockmap 和错误 app-update provider', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-package-invalid-'))
  try {
    await writeCompleteFixture({
      outputDirectory: root,
      platform: 'win32',
      arch: 'x64',
      version: '1.2.3',
    })
    await rm(
      path.join(root, 'Termous-1.2.3-windows-x64-setup.exe.blockmap'),
    )
    await assert.rejects(
      validatePackageArtifacts({
        outputDirectory: root,
        platform: 'win32',
        arch: 'x64',
        version: '1.2.3',
      }),
      /blockmap.*不存在/,
    )

    await writeFile(
      path.join(root, 'Termous-1.2.3-windows-x64-setup.exe.blockmap'),
      'blockmap',
    )
    const payloadPath = path.join(
      root,
      'Termous-1.2.3-windows-x64-setup.exe',
    )
    const originalPayload = await readFile(payloadPath)
    await writeFile(payloadPath, Buffer.alloc(originalPayload.length, 0x78))
    await assert.rejects(
      validatePackageArtifacts({
        outputDirectory: root,
        platform: 'win32',
        arch: 'x64',
        version: '1.2.3',
      }),
      /SHA512 或 size 错误/,
    )
    await writeFile(payloadPath, originalPayload)
    await writeFile(
      path.join(root, 'win-unpacked', 'resources', 'app-update.yml'),
      stringifyYaml({
        provider: 'generic',
        url: 'https://invalid.example.test',
      }),
    )
    await assert.rejects(
      validatePackageArtifacts({
        outputDirectory: root,
        platform: 'win32',
        arch: 'x64',
        version: '1.2.3',
      }),
      /更新源不正确/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('构建完成后才校验产物且子进程看不到发布凭据', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-package-run-'))
  const webDirectory = path.join(root, 'web')
  const outputDirectory = path.join(root, 'build', 'output')
  try {
    await mkdir(webDirectory, { recursive: true })
    await writeFile(
      path.join(webDirectory, 'package.json'),
      JSON.stringify({ version: '1.2.3' }),
    )
    await mkdir(outputDirectory, { recursive: true })
    await writeFile(path.join(outputDirectory, 'stale.txt'), 'stale')
    let invocation
    await runLocalPackage({
      webDirectory,
      outputDirectory,
      platform: 'win32',
      arch: 'x64',
      version: '1.2.3',
    }, {
      spawnProcess: async (executable, args, options) => {
        invocation = { executable, args, options }
        await assert.rejects(
          readFile(path.join(outputDirectory, 'stale.txt'), 'utf8'),
          /ENOENT/,
        )
        await writeCompleteFixture({
          outputDirectory,
          platform: 'win32',
          arch: 'x64',
          version: '1.2.3',
        })
      },
    })

    assert.ok(invocation)
    assert.deepEqual(invocation.args.slice(-2), ['--publish', 'never'])
    assert.equal(invocation.options.env.GH_TOKEN, undefined)
    assert.equal(invocation.options.env.GITHUB_TOKEN, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeCompleteFixture({
  outputDirectory,
  platform,
  arch,
  version,
}) {
  const prefix = `Termous-${version}`
  let manifestName
  let payloads
  let files
  if (platform === 'win32') {
    const payload = `${prefix}-windows-${arch}-setup.exe`
    manifestName = 'latest.yml'
    payloads = [payload]
    files = [payload, `${payload}.blockmap`]
  } else if (platform === 'linux') {
    const payload = `${prefix}-linux-${arch}.AppImage`
    manifestName = 'latest-linux.yml'
    payloads = [payload]
    files = [payload]
  } else {
    const zip = `${prefix}-macos-${arch}.zip`
    const dmg = `${prefix}-macos-${arch}.dmg`
    manifestName = 'latest-mac.yml'
    payloads = [zip, dmg]
    files = [zip, dmg, `${zip}.blockmap`]
  }

  const resourcesDirectory = platform === 'win32'
    ? path.join(outputDirectory, 'win-unpacked', 'resources')
    : platform === 'linux'
      ? path.join(outputDirectory, 'linux-unpacked', 'resources')
      : path.join(
        outputDirectory,
        arch === 'arm64' ? 'mac-arm64' : 'mac',
        'Termous.app',
        'Contents',
        'Resources',
      )
  await mkdir(resourcesDirectory, {
    recursive: true,
  })
  for (const fileName of files) {
    await writeFile(path.join(outputDirectory, fileName), `fixture:${fileName}`)
  }
  const payloadDigests = new Map()
  for (const payload of payloads) {
    payloadDigests.set(
      payload,
      await hashRegularFile(path.join(outputDirectory, payload)),
    )
  }
  await writeFile(
    path.join(outputDirectory, manifestName),
    stringifyYaml({
      version,
      files: payloads.map((url) => ({
        url,
        sha512: payloadDigests.get(url).sha512,
        size: payloadDigests.get(url).size,
        ...(platform === 'linux' ? { blockMapSize: 1 } : {}),
      })),
      path: payloads[0],
      sha512: payloadDigests.get(payloads[0]).sha512,
    }),
  )
  await writeFile(
    path.join(resourcesDirectory, 'app-update.yml'),
    stringifyYaml({
      provider: 'github',
      owner: 'Countra',
      repo: 'termous',
      channel: 'latest',
      publishAutoUpdate: true,
    }),
  )
  await writeFile(
    path.join(
      resourcesDirectory,
      platform === 'win32' ? 'termous-core.exe' : 'termous-core',
    ),
    'fixture-core',
  )
}
