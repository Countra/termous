import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UpdateManager,
  UpdateOperationError,
  type InstallLifecycle,
  type UpdateCheckResult,
  type UpdateDownloadContext,
  type UpdateEngine,
} from './updateManager.ts'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

interface EngineFixture {
  engine: UpdateEngine
  checkCalls: number
  downloadContexts: UpdateDownloadContext[]
  cancelCalls: number[]
  installCalls: number
  nextCheck: () => Deferred<UpdateCheckResult>
  nextDownload: () => Deferred<void>
}

const availableResult: UpdateCheckResult = {
  update_available: true,
  release: {
    version: '1.2.3',
    release_name: 'Termous 1.2.3',
    release_date: '2026-07-25T00:00:00Z',
    release_notes: '### 稳定性\n\n- <b>连接</b> 改进\n- 重试修复',
  },
}

test('检查和下载事务使用 singleflight 且发布信息经过净化', async () => {
  const fixture = createEngineFixture()
  const lifecycle = createInstallLifecycle()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: lifecycle.lifecycle,
    now: () => Date.parse('2026-07-25T01:00:00Z'),
  })

  const checkDeferred = fixture.nextCheck()
  const firstCheck = manager.check()
  const secondCheck = manager.check()
  assert.equal(firstCheck, secondCheck)
  assert.equal(fixture.checkCalls, 1)

  checkDeferred.resolve(availableResult)
  const checked = await firstCheck
  assert.equal(checked.phase, 'available')
  assert.equal(checked.available_version, '1.2.3')
  assert.equal(
    checked.release_notes,
    '### 稳定性\n\n- **连接** 改进\n- 重试修复',
  )
  const downloadDeferred = fixture.nextDownload()
  const firstDownload = manager.download()
  const secondDownload = manager.download()
  assert.equal(firstDownload, secondDownload)
  assert.equal(fixture.downloadContexts.length, 1)

  downloadDeferred.resolve()
  const downloaded = await firstDownload
  assert.equal(downloaded.phase, 'downloaded')
  assert.equal(downloaded.progress?.percent, 100)
})

test('同一下载 generation 内的进度单调且非法数值被归一化', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: createInstallLifecycle().lifecycle,
  })
  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked

  const downloadDeferred = fixture.nextDownload()
  const downloading = manager.download()
  const context = fixture.downloadContexts[0]
  context.onProgress({
    percent: 50,
    transferred: 50,
    total: 100,
    bytes_per_second: 80,
  })
  context.onProgress({
    percent: 20,
    transferred: 20,
    total: 80,
    bytes_per_second: Number.NaN,
  })

  assert.deepEqual(manager.getSnapshot().progress, {
    percent: 50,
    transferred: 50,
    total: 100,
    bytes_per_second: 0,
  })

  context.onProgress({
    percent: 30,
    transferred: 60,
    total: 120,
    bytes_per_second: 40,
  })
  assert.deepEqual(manager.getSnapshot().progress, {
    percent: 50,
    transferred: 60,
    total: 120,
    bytes_per_second: 40,
  })

  downloadDeferred.resolve()
  await downloading
})

test('差分下载回退完整包后按新字节基线展示真实进度', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: createInstallLifecycle().lifecycle,
  })
  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked

  const downloadDeferred = fixture.nextDownload()
  const downloading = manager.download()
  const context = fixture.downloadContexts[0]
  context.onProgress({
    percent: 100,
    transferred: 50,
    total: 50,
    bytes_per_second: 8,
  })
  assert.equal(manager.getSnapshot().progress?.percent, 99)

  context.onProgress({
    percent: 42,
    transferred: 54,
    total: 130,
    bytes_per_second: 12,
  })
  assert.deepEqual(manager.getSnapshot().progress, {
    percent: (54 / 130) * 100,
    transferred: 54,
    total: 130,
    bytes_per_second: 12,
  })

  downloadDeferred.resolve()
  const downloaded = await downloading
  assert.deepEqual(downloaded.progress, {
    percent: 100,
    transferred: 130,
    total: 130,
    bytes_per_second: 0,
  })
})

test('取消后旧 generation 的迟到进度和完成不会覆盖新下载', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: createInstallLifecycle().lifecycle,
  })
  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked

  const oldDeferred = fixture.nextDownload()
  const oldDownload = manager.download()
  const oldContext = fixture.downloadContexts[0]
  oldContext.onProgress({ percent: 40, transferred: 40, total: 100 })
  await manager.cancelDownload()
  assert.equal(manager.getSnapshot().phase, 'available')

  const newDeferred = fixture.nextDownload()
  const newDownload = manager.download()
  const newContext = fixture.downloadContexts[1]
  oldContext.onProgress({ percent: 99, transferred: 99, total: 100 })
  newContext.onProgress({ percent: 10, transferred: 10, total: 100 })
  assert.equal(manager.getSnapshot().progress?.percent, 10)

  newDeferred.resolve()
  await newDownload
  const completedGeneration = manager.getSnapshot().operation_generation
  oldDeferred.resolve()
  await oldDownload

  assert.equal(manager.getSnapshot().phase, 'downloaded')
  assert.equal(manager.getSnapshot().operation_generation, completedGeneration)
  assert.deepEqual(fixture.cancelCalls, [oldContext.generation])
})

test('安装严格按准备、进入安装态、启动安装器顺序执行并复用事务', async () => {
  const events: string[] = []
  const fixture = createEngineFixture(events)
  const lifecycle = createInstallLifecycle(events)
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: lifecycle.lifecycle,
  })
  manager.subscribe((snapshot) => {
    if (snapshot.phase === 'preparing_install' || snapshot.phase === 'installing') {
      events.push(`state:${snapshot.phase}`)
    }
  })

  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked
  const downloadDeferred = fixture.nextDownload()
  const downloaded = manager.download()
  downloadDeferred.resolve()
  await downloaded

  const firstInstall = manager.install()
  const secondInstall = manager.install()
  assert.equal(firstInstall, secondInstall)
  assert.equal(manager.getSnapshot().phase, 'preparing_install')
  lifecycle.prepareDeferred.resolve()
  await firstInstall

  assert.deepEqual(events.slice(-4), [
    'state:preparing_install',
    'lifecycle:prepare',
    'state:installing',
    'engine:install',
  ])
  assert.equal(fixture.installCalls, 1)
})

test('核心退出失败时不启动安装器并返回稳定错误码', async () => {
  const fixture = createEngineFixture()
  const lifecycle: InstallLifecycle = {
    prepareForInstall: async () => {
      throw new Error('包含本地路径的底层错误')
    },
  }
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: lifecycle,
  })

  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked
  const downloadDeferred = fixture.nextDownload()
  const downloaded = manager.download()
  downloadDeferred.resolve()
  await downloaded
  const failed = await manager.install()

  assert.equal(failed.phase, 'error')
  assert.equal(failed.error_code, 'UPDATE_CORE_SHUTDOWN_FAILED')
  assert.equal(failed.error_message, '核心服务未能安全退出，更新尚未安装')
  assert.equal(fixture.installCalls, 0)
})

test('安装准备失败后可以复用已下载文件重试安装', async () => {
  const fixture = createEngineFixture()
  let prepareCalls = 0
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: {
      prepareForInstall: async () => {
        prepareCalls += 1
        if (prepareCalls === 1) {
          throw new Error('首次退出失败')
        }
      },
    },
  })

  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked
  const downloadDeferred = fixture.nextDownload()
  const downloaded = manager.download()
  downloadDeferred.resolve()
  await downloaded

  assert.equal((await manager.install()).error_code, 'UPDATE_CORE_SHUTDOWN_FAILED')
  assert.equal((await manager.install()).phase, 'installing')
  assert.equal(prepareCalls, 2)
  assert.equal(fixture.installCalls, 1)
})

test('不可重试的安装准备错误不会再次进入安装事务', async () => {
  const fixture = createEngineFixture()
  let prepareCalls = 0
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: {
      prepareForInstall: async () => {
        prepareCalls += 1
        throw new UpdateOperationError(
          'UPDATE_CORE_SHUTDOWN_FAILED',
          '核心服务未能安全退出，更新尚未安装',
          false,
        )
      },
    },
  })

  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked
  const downloadDeferred = fixture.nextDownload()
  const downloaded = manager.download()
  downloadDeferred.resolve()
  await downloaded

  const failed = await manager.install()
  assert.equal(failed.error_code, 'UPDATE_CORE_SHUTDOWN_FAILED')
  assert.equal(failed.retryable, false)
  assert.equal((await manager.install()).state_seq, failed.state_seq)
  assert.equal(prepareCalls, 1)
  assert.equal(fixture.installCalls, 0)
})

test('只有安装器启动失败才执行安装失败收口', async () => {
  const fixture = createEngineFixture()
  let recoveryCalls = 0
  const manager = new UpdateManager({
    engine: {
      ...fixture.engine,
      installUpdate: async () => {
        throw new Error('installer failed')
      },
    },
    installLifecycle: {
      prepareForInstall: async () => undefined,
      recoverFromInstallFailure: async () => {
        recoveryCalls += 1
        return true
      },
    },
  })

  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked
  const downloadDeferred = fixture.nextDownload()
  const downloaded = manager.download()
  downloadDeferred.resolve()
  await downloaded

  const failed = await manager.install()
  assert.equal(failed.error_code, 'UPDATE_INSTALL_START_FAILED')
  assert.equal(failed.retryable, true)
  assert.equal(recoveryCalls, 1)
})

test('安装失败且应用无法恢复时不会暴露不可执行的重试', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: {
      ...fixture.engine,
      installUpdate: async () => {
        throw new Error('installer failed')
      },
    },
    installLifecycle: {
      prepareForInstall: async () => undefined,
      recoverFromInstallFailure: async () => false,
    },
  })

  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked
  const downloadDeferred = fixture.nextDownload()
  const downloaded = manager.download()
  downloadDeferred.resolve()
  await downloaded

  const failed = await manager.install()
  assert.equal(failed.error_code, 'UPDATE_INSTALL_START_FAILED')
  assert.equal(failed.retryable, false)
})

test('引擎稳定错误会保留错误码且不会泄露普通异常内容', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: createInstallLifecycle().lifecycle,
  })

  const typedDeferred = fixture.nextCheck()
  const typedCheck = manager.check()
  typedDeferred.reject(new UpdateOperationError(
    'UPDATE_METADATA_INVALID',
    '更新元数据无效',
    true,
  ))
  assert.equal((await typedCheck).error_code, 'UPDATE_METADATA_INVALID')

  const rawDeferred = fixture.nextCheck()
  const rawCheck = manager.check()
  rawDeferred.reject(new Error('C:\\secret\\update-cache'))
  const failed = await rawCheck
  assert.equal(failed.error_code, 'UPDATE_CHECK_FAILED')
  assert.equal(failed.error_message, '检查更新失败，请稍后重试')
  assert.equal(failed.error_message?.includes('secret'), false)
})

test('不可重试的签名错误不会重新启动下载事务', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: createInstallLifecycle().lifecycle,
  })
  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked

  const downloadDeferred = fixture.nextDownload()
  const downloading = manager.download()
  downloadDeferred.reject(new UpdateOperationError(
    'UPDATE_SIGNATURE_INVALID',
    '更新包签名校验失败',
    false,
  ))
  const failed = await downloading

  assert.equal(failed.error_code, 'UPDATE_SIGNATURE_INVALID')
  assert.equal(failed.retryable, false)
  assert.equal(fixture.downloadContexts.length, 1)
  assert.equal((await manager.download()).error_code, 'UPDATE_SIGNATURE_INVALID')
  assert.equal(fixture.downloadContexts.length, 1)
})

test('检查时间落盘失败时保留持久偏好序号并允许后续设置覆盖', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: createInstallLifecycle().lifecycle,
    now: () => Date.parse('2026-07-25T01:00:00Z'),
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: null,
      revision: 4,
    },
    persistPreferences: async () => {
      throw new Error('disk unavailable')
    },
  })
  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  const result = await checked

  assert.equal(result.preferences.last_checked_at, '2026-07-25T01:00:00.000Z')
  assert.equal(result.preferences.revision, 4)

  const updated = manager.setPreferences({
    ...result.preferences,
    automatic_check: false,
    revision: 5,
  })
  assert.equal(updated.preferences.automatic_check, false)
  assert.equal(updated.preferences.revision, 5)
})

test('状态监听器相互隔离且单个监听器异常不会中断状态事务', async () => {
  const fixture = createEngineFixture()
  const manager = new UpdateManager({
    engine: fixture.engine,
    installLifecycle: createInstallLifecycle().lifecycle,
  })
  const observed: string[] = []
  manager.subscribe((snapshot) => {
    snapshot.phase = 'unsupported'
    throw new Error('监听器异常')
  })
  manager.subscribe((snapshot) => {
    observed.push(snapshot.phase)
  })

  const checkDeferred = fixture.nextCheck()
  const checked = manager.check()
  checkDeferred.resolve(availableResult)
  await checked

  assert.equal(manager.getSnapshot().phase, 'available')
  assert.equal(observed[observed.length - 1], 'available')
})

function createEngineFixture(events: string[] = []): EngineFixture {
  const checkQueue: Array<Deferred<UpdateCheckResult>> = []
  const downloadQueue: Array<Deferred<void>> = []
  const downloadContexts: UpdateDownloadContext[] = []
  const cancelCalls: number[] = []
  let checkCalls = 0
  let installCalls = 0

  const fixture: EngineFixture = {
    engine: {
      currentVersion: '1.0.0',
      support: { supported: true },
      checkForUpdates: () => {
        checkCalls += 1
        const pending = checkQueue.shift()
        if (!pending) {
          throw new Error('缺少检查测试事务')
        }
        return pending.promise
      },
      downloadUpdate: (context) => {
        downloadContexts.push(context)
        const pending = downloadQueue.shift()
        if (!pending) {
          throw new Error('缺少下载测试事务')
        }
        return pending.promise
      },
      cancelDownload: async (generation) => {
        cancelCalls.push(generation)
      },
      installUpdate: async () => {
        installCalls += 1
        events.push('engine:install')
      },
    },
    get checkCalls() {
      return checkCalls
    },
    downloadContexts,
    cancelCalls,
    get installCalls() {
      return installCalls
    },
    nextCheck: () => {
      const pending = deferred<UpdateCheckResult>()
      checkQueue.push(pending)
      return pending
    },
    nextDownload: () => {
      const pending = deferred<void>()
      downloadQueue.push(pending)
      return pending
    },
  }
  return fixture
}

function createInstallLifecycle(events: string[] = []) {
  const prepareDeferred = deferred<void>()
  const lifecycle: InstallLifecycle = {
    prepareForInstall: async () => {
      events.push('lifecycle:prepare')
      await prepareDeferred.promise
    },
  }
  return { lifecycle, prepareDeferred }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
