import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertProductionBundleExcludesSimulation,
  assertSafeSimulationOutputRoot,
  buildUpdateSimulationFixtures,
  sanitizeSimulationEnvironment,
  validateUpdateSimulationFixtures,
} from './build-fixtures.mjs'

test('模拟构建环境移除全部发布与签名凭据', () => {
  const sanitized = sanitizeSimulationEnvironment({
    GH_TOKEN: 'secret',
    GITHUB_TOKEN: 'secret',
    WIN_CSC_LINK: 'secret',
    MAC_CSC_LINK: 'secret',
    CSC_KEY_PASSWORD: 'secret',
    RELEASE_APP_ID: 'secret',
    RELEASE_APP_PRIVATE_KEY: 'secret',
    APPLE_API_KEY_BASE64: 'secret',
    APPLE_API_KEY_ID: 'secret',
    APPLE_API_ISSUER: 'secret',
    gh_token: 'lower-secret',
    release_app_private_key: 'lower-secret',
    termous_build_update_simulation: '1',
    csc_identity_auto_discovery: 'true',
    no_proxy: 'lower-host',
    NO_PROXY: 'localhost',
    vite_termous_app_version: 'lower-version',
    VITE_TERMOUS_APP_VERSION: '9.8.7',
    SAFE_VALUE: 'kept',
  })

  assert.equal(sanitized.GH_TOKEN, undefined)
  assert.equal(sanitized.GITHUB_TOKEN, undefined)
  assert.equal(sanitized.WIN_CSC_LINK, undefined)
  assert.equal(sanitized.MAC_CSC_LINK, undefined)
  assert.equal(sanitized.CSC_KEY_PASSWORD, undefined)
  assert.equal(sanitized.RELEASE_APP_ID, undefined)
  assert.equal(sanitized.RELEASE_APP_PRIVATE_KEY, undefined)
  assert.equal(sanitized.APPLE_API_KEY_BASE64, undefined)
  assert.equal(sanitized.APPLE_API_KEY_ID, undefined)
  assert.equal(sanitized.APPLE_API_ISSUER, undefined)
  assert.equal(sanitized.gh_token, undefined)
  assert.equal(sanitized.release_app_private_key, undefined)
  assert.equal(sanitized.termous_build_update_simulation, undefined)
  assert.equal(sanitized.csc_identity_auto_discovery, undefined)
  assert.equal(sanitized.SAFE_VALUE, 'kept')
  assert.equal(sanitized.CSC_IDENTITY_AUTO_DISCOVERY, 'false')
  assert.equal(sanitized.NO_PROXY, 'localhost,127.0.0.1')
  assert.equal(sanitized.no_proxy, undefined)
  assert.equal(sanitized.VITE_TERMOUS_APP_VERSION, '9.8.7')
  assert.equal(sanitized.vite_termous_app_version, undefined)
})

test('fixture 校验要求隔离身份、固定 feed 和完整候选资产', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'termous-update-fixture-'))
  const baselineDirectory = path.join(root, 'baseline')
  const candidateDirectory = path.join(root, 'candidate')
  const resources = path.join(baselineDirectory, 'win-unpacked', 'resources')
  const executable = path.join(
    baselineDirectory,
    'win-unpacked',
    'TermousUpdateSimulation.exe',
  )
  const installerName = 'Termous-Update-Simulation-0.0.2-windows-x64-setup.exe'
  try {
    await mkdir(resources, { recursive: true })
    await mkdir(candidateDirectory, { recursive: true })
    await writeFile(executable, 'baseline')
    await writeFile(
      path.join(resources, 'app-update.yml'),
      [
        'provider: generic',
        'url: http://127.0.0.1:18991',
        'useMultipleRangeRequest: false',
        'updaterCacheDirName: termous-update-simulation-updater',
      ].join('\n'),
    )
    await writeFile(
      path.join(resources, 'update-simulation-profile.marker'),
      'termous-update-simulation-v1\n',
    )
    await writeFile(path.join(candidateDirectory, installerName), 'candidate')
    await writeFile(`${path.join(candidateDirectory, installerName)}.blockmap`, 'map')
    await writeFile(
      path.join(candidateDirectory, 'latest.yml'),
      [
        'version: 0.0.2',
        'files:',
        `  - url: ${installerName}`,
        '    sha512: fixture',
        '    size: 9',
      ].join('\n'),
    )

    const result = await validateUpdateSimulationFixtures({
      baselineDirectory,
      candidateDirectory,
    })
    assert.equal(result.baselineExecutable, executable)
    assert.equal(result.installer, path.join(candidateDirectory, installerName))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('生产构建契约拒绝 Renderer 与 Electron 开发模拟标记', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'termous-update-dist-'))
  const electronRoot = await mkdtemp(
    path.join(os.tmpdir(), 'termous-update-electron-dist-'),
  )
  try {
    await writeFile(path.join(root, 'safe.js'), 'console.log("termous")')
    await writeFile(
      path.join(electronRoot, 'safe.js'),
      'console.log("production-main")',
    )
    await assertProductionBundleExcludesSimulation([root, electronRoot])
    await writeFile(
      path.join(electronRoot, 'unsafe.cjs'),
      'console.log("simulation_install_blocked")',
    )
    await assert.rejects(
      assertProductionBundleExcludesSimulation([root, electronRoot]),
      /生产构建包含开发模拟标记/,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
    await rm(electronRoot, { force: true, recursive: true })
  }
})

test('fixture 失败后恢复正式入口并保留调用方正式版本', async () => {
  const webDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'termous-update-build-restore-'),
  )
  const calls = []
  try {
    await assert.rejects(
      buildUpdateSimulationFixtures({
        webDirectory,
        outputRoot: path.join(
          webDirectory,
          'release',
          'update-simulation',
        ),
      }, {
        environment: {
          TERMOUS_BUILD_UPDATE_SIMULATION: 'inherited',
          termous_build_update_simulation: 'inherited-lower',
          VITE_TERMOUS_APP_VERSION: '9.8.7',
        },
        spawnProcess: async (_executable, _argumentsList, options) => {
          calls.push(options)
          if (calls.length === 1) {
            throw new Error('fixture_build_failed')
          }
        },
      }),
      /fixture_build_failed/,
    )
    assert.equal(calls.length, 2)
    assert.equal(calls[0].env.TERMOUS_BUILD_UPDATE_SIMULATION, '1')
    assert.equal(calls[0].env.VITE_TERMOUS_APP_VERSION, '0.0.1')
    assert.equal(
      calls[1].env.TERMOUS_BUILD_UPDATE_SIMULATION,
      undefined,
    )
    assert.equal(
      Object.keys(calls[1].env).some(
        (name) => name.toUpperCase() === 'TERMOUS_BUILD_UPDATE_SIMULATION',
      ),
      false,
    )
    assert.equal(calls[1].env.VITE_TERMOUS_APP_VERSION, '9.8.7')
  } finally {
    await rm(webDirectory, { force: true, recursive: true })
  }
})

test('模拟输出目录拒绝通过 release 联接清理工作区外目录', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'termous-update-output-root-'))
  const webDirectory = path.join(root, 'web')
  const externalDirectory = path.join(root, 'external')
  try {
    await mkdir(webDirectory)
    await mkdir(externalDirectory)
    try {
      await symlink(
        externalDirectory,
        path.join(webDirectory, 'release'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        context.skip('当前系统不允许创建测试用目录联接')
        return
      }
      throw error
    }

    await assert.rejects(
      assertSafeSimulationOutputRoot(
        path.join(webDirectory, 'release', 'update-simulation'),
        webDirectory,
      ),
      /不能是符号链接、联接或/,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
