import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { CancellationError, type CancellationToken } from 'builder-util-runtime'
import {
  createElectronUpdaterEngine,
  type ElectronUpdaterCheckResult,
  type ElectronUpdaterEngineOptions,
  type ElectronUpdaterProgress,
} from './electronUpdaterEngine.ts'
import {
  UpdateManager,
  UpdateOperationError,
} from './updateManager.ts'

const packagedApp = {
  isPackaged: true,
  getVersion: () => '1.0.0',
}

test('配置固定安全默认值且不覆盖生产更新源', () => {
  const updater = new FakeUpdater()
  const engine = createTestEngine(updater)

  assert.equal(engine.currentVersion, '1.0.0')
  assert.deepEqual(engine.support, { supported: true })
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowPrerelease, false)
  assert.equal(updater.allowDowngrade, false)
  assert.equal(updater.disableWebInstaller, true)
  assert.equal(updater.logger, null)
  assert.equal(updater.setFeedURLCalls, 0)
})

test('稳定版本不接收预发布更新，预发布版本继续跟随预发布更新', () => {
  const stableUpdater = new FakeUpdater()
  createElectronUpdaterEngine({
    updater: stableUpdater,
    app: packagedApp,
    platform: 'win32',
    isWindowsStore: false,
  })
  assert.equal(stableUpdater.allowPrerelease, false)

  const prereleaseUpdater = new FakeUpdater()
  createElectronUpdaterEngine({
    updater: prereleaseUpdater,
    app: {
      isPackaged: true,
      getVersion: () => '1.2.0-beta.3+build.8',
    },
    platform: 'win32',
    isWindowsStore: false,
  })
  assert.equal(prereleaseUpdater.allowPrerelease, true)
})

test('开发环境、商店格式、非 AppImage Linux 和未知平台均不受支持', async () => {
  const cases: Array<{
    options: Omit<ElectronUpdaterEngineOptions, 'updater'>
    reason: string
  }> = [
    {
      options: {
        app: { ...packagedApp, isPackaged: false },
        platform: 'win32',
      },
      reason: 'not_packaged',
    },
    {
      options: {
        app: packagedApp,
        platform: 'win32',
        isWindowsStore: true,
      },
      reason: 'unsupported_windows_store',
    },
    {
      options: {
        app: packagedApp,
        platform: 'darwin',
        isMacAppStore: true,
      },
      reason: 'unsupported_mac_app_store',
    },
    {
      options: {
        app: packagedApp,
        platform: 'linux',
        env: {},
      },
      reason: 'unsupported_linux_package',
    },
    {
      options: {
        app: packagedApp,
        platform: 'freebsd',
      },
      reason: 'unsupported_platform',
    },
  ]

  for (const { options, reason } of cases) {
    const engine = createElectronUpdaterEngine({
      updater: new FakeUpdater(),
      ...options,
    })
    assert.deepEqual(engine.support, { supported: false, reason })
    await assert.rejects(
      engine.installUpdate(),
      (error) => isUpdateError(error, 'UPDATE_UNSUPPORTED', false),
    )
  }

  const appImagePath = '/opt/Termous/Termous.AppImage'
  const appImageParentPath = '/opt/Termous'
  const createAppImageFileSystem = (input: {
    regularFile?: boolean
    writablePaths?: readonly string[]
  } = {}) => ({
    isRegularFile: (filePath: string) => (
      filePath === appImagePath && input.regularFile !== false
    ),
    isWritable: (filePath: string) => (
      input.writablePaths?.includes(filePath) === true
    ),
  })

  const appImageEngine = createElectronUpdaterEngine({
    updater: new FakeUpdater(),
    app: packagedApp,
    platform: 'linux',
    env: { APPIMAGE: appImagePath },
    appImageFileSystem: createAppImageFileSystem({
      writablePaths: [appImagePath, appImageParentPath],
    }),
  })
  assert.deepEqual(appImageEngine.support, { supported: true })

  const parentReadOnlyAppImageEngine = createElectronUpdaterEngine({
    updater: new FakeUpdater(),
    app: packagedApp,
    platform: 'linux',
    env: { APPIMAGE: appImagePath },
    appImageFileSystem: createAppImageFileSystem({
      writablePaths: [appImagePath],
    }),
  })
  assert.deepEqual(parentReadOnlyAppImageEngine.support, {
    supported: false,
    reason: 'appimage_not_writable',
  })

  const nonRegularAppImageEngine = createElectronUpdaterEngine({
    updater: new FakeUpdater(),
    app: packagedApp,
    platform: 'linux',
    env: { APPIMAGE: appImagePath },
    appImageFileSystem: createAppImageFileSystem({
      regularFile: false,
      writablePaths: [appImagePath, appImageParentPath],
    }),
  })
  assert.deepEqual(nonRegularAppImageEngine.support, {
    supported: false,
    reason: 'appimage_not_writable',
  })
})

test('检查结果归一发布信息并安全转换数组形式的 release notes', async () => {
  const updater = new FakeUpdater()
  updater.checkResult = {
    isUpdateAvailable: true,
    updateInfo: {
      version: ' 1.2.3 ',
      releaseName: ' Termous 1.2.3 ',
      releaseDate: ' 2026-07-25T00:00:00Z ',
      releaseNotes: [
        {
          version: '1.2.2',
          note: '<h2>修复</h2><p>连接 &amp; 重试</p>',
        },
        {
          version: '1.2.3',
          note: '<script>steal()</script><h3>Changed</h3><ul><li><b>性能提升</b></li></ul>',
        },
      ],
    },
  }
  const engine = createTestEngine(updater)

  const result = await engine.checkForUpdates()

  assert.deepEqual(result, {
    update_available: true,
    release: {
      version: '1.2.3',
      release_name: 'Termous 1.2.3',
      release_date: '2026-07-25T00:00:00Z',
      release_notes: '## 修复\n\n连接 & 重试\n\n### Changed\n\n- **性能提升**',
    },
  })
  assert.equal(result.release?.release_notes?.includes('<'), false)
  assert.equal(result.release?.release_notes?.includes('steal'), false)

  updater.checkResult = {
    isUpdateAvailable: true,
    updateInfo: {
      version: '1.2.4',
      releaseNotes: [
        {
          version: '1.2.3',
          note: `${' '.repeat(7_990)}<!-- 未闭合`,
        },
        {
          version: '1.2.3',
          note: '```text\n<source>',
        },
        {
          version: '1.2.4',
          note: '<h3>有效说明</h3><ul><li>不会被上一项吞掉</li></ul>',
        },
      ],
    },
  }
  const separatedNotes = await engine.checkForUpdates()
  assert.equal(
    separatedNotes.release?.release_notes?.includes('### 有效说明'),
    true,
  )
  assert.equal(
    separatedNotes.release?.release_notes?.includes('- 不会被上一项吞掉'),
    true,
  )
  assert.equal(
    separatedNotes.release?.release_notes?.includes(
      '```text\n<source>\n```\n\n### 有效说明',
    ),
    true,
  )

  updater.checkResult = {
    isUpdateAvailable: false,
    updateInfo: { version: '1.0.0' },
  }
  assert.deepEqual(
    await engine.checkForUpdates(),
    { update_available: false },
  )
})

test('空检查结果和底层检查异常转换为稳定错误且不泄露原始消息', async () => {
  const updater = new FakeUpdater()
  const engine = createTestEngine(updater)

  updater.checkResult = null
  await assert.rejects(
    engine.checkForUpdates(),
    (error) => isUpdateError(error, 'UPDATE_UNSUPPORTED', false),
  )

  updater.checkError = codedError(
    'ERR_UPDATER_INVALID_UPDATE_INFO',
    'C:\\private\\latest.yml',
  )
  await assert.rejects(
    engine.checkForUpdates(),
    (error) => isUpdateError(error, 'UPDATE_METADATA_INVALID', true),
  )

  updater.checkError = new Error('C:\\secret\\token')
  await assert.rejects(
    engine.checkForUpdates(),
    (error) => {
      assert.equal(
        isUpdateError(error, 'UPDATE_CHECK_FAILED', true),
        true,
      )
      assert.equal((error as Error).message.includes('secret'), false)
      return true
    },
  )
})

test('下载传递 CancellationToken、转换进度并在完成后清理监听器', async () => {
  const updater = new FakeUpdater()
  const progress: ElectronUpdaterProgress[] = []
  let receivedToken: CancellationToken | undefined
  updater.downloadHandler = async (token) => {
    receivedToken = token
    updater.emit('download-progress', {
      percent: 25,
      transferred: 10,
      total: 40,
      bytesPerSecond: 80,
    } satisfies ElectronUpdaterProgress)
    return ['update.exe']
  }
  const engine = createTestEngine(updater)

  await engine.downloadUpdate({
    generation: 3,
    signal: new AbortController().signal,
    onProgress: (value) => {
      progress.push({
        percent: value.percent ?? 0,
        transferred: value.transferred ?? 0,
        total: value.total ?? 0,
        bytesPerSecond: value.bytes_per_second ?? 0,
      })
    },
  })

  assert.ok(receivedToken)
  assert.equal(receivedToken.cancelled, false)
  assert.deepEqual(progress, [{
    percent: 25,
    transferred: 10,
    total: 40,
    bytesPerSecond: 80,
  }])
  assert.equal(updater.listenerCount('download-progress'), 0)
})

test('取消只作用于指定 generation 并等待底层下载结束后清理监听器', async () => {
  const updater = new FakeUpdater()
  const controller = new AbortController()
  let receivedToken: CancellationToken | undefined
  updater.downloadHandler = (token) => {
    receivedToken = token
    return new Promise<readonly string[]>((_resolve, reject) => {
      token.once('cancel', () => {
        reject(new CancellationError())
      })
    })
  }
  const engine = createTestEngine(updater)
  const download = engine.downloadUpdate({
    generation: 7,
    signal: controller.signal,
    onProgress: () => undefined,
  })

  await engine.cancelDownload(8)
  assert.equal(receivedToken?.cancelled, false)
  controller.abort()
  const cancellation = engine.cancelDownload(7)

  await assert.rejects(
    download,
    (error) => isUpdateError(error, 'UPDATE_DOWNLOAD_CANCELED', true),
  )
  await cancellation
  assert.equal(receivedToken?.cancelled, true)
  assert.equal(updater.listenerCount('download-progress'), 0)
})

test('下载错误稳定区分资源、哈希、签名和普通失败', async () => {
  const cases: Array<{
    error: Error
    code: Parameters<typeof isUpdateError>[1]
    retryable: boolean
  }> = [
    {
      error: codedError('ERR_UPDATER_ASSET_NOT_FOUND', 'private asset URL'),
      code: 'UPDATE_ASSET_NOT_FOUND',
      retryable: true,
    },
    {
      error: codedError('ERR_CHECKSUM_MISMATCH', 'private checksum values'),
      code: 'UPDATE_HASH_MISMATCH',
      retryable: true,
    },
    {
      error: codedError('ERR_UPDATER_INVALID_SIGNATURE', 'private publisher'),
      code: 'UPDATE_SIGNATURE_INVALID',
      retryable: false,
    },
    {
      error: new Error('C:\\secret\\download-cache'),
      code: 'UPDATE_DOWNLOAD_FAILED',
      retryable: true,
    },
  ]

  for (const [index, current] of cases.entries()) {
    const updater = new FakeUpdater()
    updater.downloadHandler = async () => {
      throw current.error
    }
    const engine = createTestEngine(updater)
    await assert.rejects(
      engine.downloadUpdate({
        generation: index + 1,
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
      (error) => {
        assert.equal(
          isUpdateError(error, current.code, current.retryable),
          true,
        )
        assert.equal((error as Error).message.includes('secret'), false)
        assert.equal((error as Error).message.includes('private'), false)
        return true
      },
    )
    assert.equal(updater.listenerCount('download-progress'), 0)
  }
})

test('安装使用显式 quitAndInstall 参数并将同步失败转换为稳定错误', async () => {
  const updater = new FakeUpdater()
  const engine = createTestEngine(updater)

  await engine.installUpdate()
  assert.deepEqual(updater.installCalls, [[false, true]])
  assert.equal(updater.listenerCount('error'), 0)

  updater.installHandler = () => {
    throw new Error('C:\\secret\\installer')
  }
  await assert.rejects(
    engine.installUpdate(),
    (error) => {
      assert.equal(
        isUpdateError(error, 'UPDATE_INSTALL_START_FAILED', true),
        true,
      )
      assert.equal((error as Error).message.includes('secret'), false)
      return true
    },
  )
  assert.equal(updater.listenerCount('error'), 0)
})

test('安装启动后异步 updater 错误进入可恢复失败并清理监听器', async () => {
  const updater = new FakeUpdater()
  updater.installHandler = () => {
    setImmediate(() => {
      updater.emit('error', new Error('C:\\secret\\async-installer'))
    })
  }
  const engine = createTestEngine(updater)

  await assert.rejects(
    engine.installUpdate(),
    (error) => {
      assert.equal(
        isUpdateError(error, 'UPDATE_INSTALL_START_FAILED', true),
        true,
      )
      assert.equal((error as Error).message.includes('secret'), false)
      return true
    },
  )
  assert.equal(updater.listenerCount('error'), 0)
})

test('真实 app 未开始退出时安装启动观察会有界失败', async () => {
  const updater = new FakeUpdater()
  const installEventSource = new FakeInstallEventSource()
  const engine = createElectronUpdaterEngine({
    updater,
    app: packagedApp,
    installEventSource,
    platform: 'win32',
    isWindowsStore: false,
    installLaunchTimeoutMs: 5,
  })

  await assert.rejects(
    engine.installUpdate(),
    (error) => isUpdateError(
      error,
      'UPDATE_INSTALL_START_FAILED',
      true,
    ),
  )
  assert.equal(
    installEventSource.listenerCount('before-quit-for-update'),
    0,
  )
  assert.equal(updater.listenerCount('error'), 0)
})

test('macOS 安装交接超时视为已提交且迟到原生退出事件不会反转结果', async () => {
  const updater = new FakeUpdater()
  updater.checkResult = {
    isUpdateAvailable: true,
    updateInfo: { version: '1.1.0' },
  }
  const installEventSource = new FakeInstallEventSource()
  const engine = createElectronUpdaterEngine({
    updater,
    app: packagedApp,
    installEventSource,
    platform: 'darwin',
    isMacAppStore: false,
    installLaunchTimeoutMs: 5,
  })
  let recoverCalls = 0
  const manager = new UpdateManager({
    engine,
    installLifecycle: {
      prepareForInstall: async () => undefined,
      recoverFromInstallFailure: async () => {
        recoverCalls += 1
        return true
      },
    },
  })

  assert.equal((await manager.check()).phase, 'available')
  assert.equal((await manager.download()).phase, 'downloaded')
  assert.equal((await manager.install()).phase, 'installing')
  assert.equal(recoverCalls, 0)
  assert.equal(
    installEventSource.listenerCount('before-quit-for-update'),
    0,
  )
  assert.equal(updater.listenerCount('error'), 0)

  installEventSource.emit('before-quit-for-update')
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

  assert.deepEqual(updater.installCalls, [[false, true]])
  assert.equal(manager.getSnapshot().phase, 'installing')
  assert.equal(recoverCalls, 0)
  assert.equal(
    installEventSource.listenerCount('before-quit-for-update'),
    0,
  )
  assert.equal(updater.listenerCount('error'), 0)
})

test('只有更新专用退出事件才能完成安装事务并清理观察器', async () => {
  const updater = new FakeUpdater()
  const app = new FakeApp()
  const installEventSource = new FakeInstallEventSource()
  updater.installHandler = () => {
    app.emit('before-quit')
    setImmediate(() => {
      installEventSource.emit('before-quit-for-update')
    })
  }
  const engine = createElectronUpdaterEngine({
    updater,
    app,
    installEventSource,
    platform: 'win32',
    isWindowsStore: false,
    installLaunchTimeoutMs: 50,
  })

  await engine.installUpdate()

  assert.deepEqual(updater.installCalls, [[false, true]])
  assert.equal(app.listenerCount('before-quit'), 0)
  assert.equal(
    installEventSource.listenerCount('before-quit-for-update'),
    0,
  )
  assert.equal(updater.listenerCount('error'), 0)
})

test('模拟验收可在引擎最底层阻止真实安装器启动', async () => {
  const updater = new FakeUpdater()
  let blockedLaunches = 0
  const engine = createElectronUpdaterEngine({
    updater,
    app: packagedApp,
    platform: 'win32',
    isWindowsStore: false,
    launchInstall: () => {
      blockedLaunches += 1
      throw new Error('simulation_install_blocked')
    },
  })

  await assert.rejects(
    engine.installUpdate(),
    (error) => isUpdateError(
      error,
      'UPDATE_INSTALL_START_FAILED',
      true,
    ),
  )
  assert.equal(blockedLaunches, 1)
  assert.deepEqual(updater.installCalls, [])
  assert.equal(updater.listenerCount('error'), 0)
})

class FakeUpdater extends EventEmitter {
  logger: {
    info: (message?: unknown) => void
    warn: (message?: unknown) => void
    error: (message?: unknown) => void
  } | null = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  disableWebInstaller = false
  setFeedURLCalls = 0
  checkResult: ElectronUpdaterCheckResult | null = {
    isUpdateAvailable: false,
    updateInfo: { version: '1.0.0' },
  }
  checkError: unknown = null
  downloadHandler: (
    token: CancellationToken,
  ) => Promise<readonly string[]> = async () => []
  installHandler: () => void = () => undefined
  installCalls: Array<[boolean | undefined, boolean | undefined]> = []

  setFeedURL() {
    this.setFeedURLCalls += 1
  }

  async checkForUpdates() {
    if (this.checkError) {
      const error = this.checkError
      this.checkError = null
      throw error
    }
    return this.checkResult
  }

  downloadUpdate(token?: CancellationToken) {
    if (!token) {
      throw new Error('测试下载缺少 CancellationToken')
    }
    return this.downloadHandler(token)
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.installCalls.push([isSilent, isForceRunAfter])
    this.installHandler()
  }
}

class FakeApp extends EventEmitter {
  readonly isPackaged = true

  getVersion() {
    return '1.0.0'
  }
}

class FakeInstallEventSource extends EventEmitter {
  override once(
    event: 'before-quit-for-update',
    listener: () => void,
  ) {
    return super.once(event, listener)
  }

  override removeListener(
    event: 'before-quit-for-update',
    listener: () => void,
  ) {
    return super.removeListener(event, listener)
  }
}

function createTestEngine(updater: FakeUpdater) {
  return createElectronUpdaterEngine({
    updater,
    app: packagedApp,
    platform: 'win32',
    isWindowsStore: false,
  })
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

function isUpdateError(
  error: unknown,
  code: UpdateOperationError['code'],
  retryable: boolean,
) {
  assert.ok(error instanceof UpdateOperationError)
  assert.equal(error.code, code)
  assert.equal(error.retryable, retryable)
  return true
}
