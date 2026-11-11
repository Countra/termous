import assert from 'node:assert/strict'
import test from 'node:test'
import { AppExitCoordinator } from './appExitCoordinator.ts'

test('更新准备排空期间收到退出请求，必须保留退出意图并最终退出', async () => {
  let release!: () => void, started!: () => void
  let flushes = 0, quits = 0
  const flushing = new Promise<void>(resolve => { started = resolve })
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => true, prepareForExit() {}, closeAllWindows() {},
    quitApplication() { quits++ },
    flushLogs() { if (++flushes > 1) return Promise.resolve(); started(); return new Promise<void>(resolve => { release = resolve }) },
  })
  const installing = coordinator.prepareUpdateInstall()
  await flushing
  let prevented = false
  assert.equal(coordinator.handleBeforeQuit({ preventDefault() { prevented = true } }), false)
  assert.equal(prevented, true)
  assert.equal(coordinator.isApplicationExiting(), true)
  release(); await installing
  await coordinator.requestApplicationExit('before_quit')
  assert.equal(quits, 1)
})

test('退出排空日志期间合并退出请求，并阻止原生退出绕过排空', async () => {
  let release!: () => void, flushing!: () => void
  const started = new Promise<void>(resolve => { flushing = resolve })
  let quits = 0, flushes = 0
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => true, prepareForExit() {}, closeAllWindows() {},
    quitApplication() { quits++ },
    flushLogs() { flushes++; flushing(); return new Promise<void>(resolve => { release = resolve }) },
  })
  const exiting = coordinator.requestApplicationExit('tray')
  await started
  assert.equal(coordinator.requestApplicationExit('main_window'), exiting)
  let prevented = false
  assert.equal(coordinator.handleBeforeQuit({ preventDefault() { prevented = true } }), false)
  assert.equal(prevented, true)
  assert.equal(quits, 0)
  release(); await exiting
  assert.equal(flushes, 1)
  assert.equal(quits, 1)
})

test('日志永久阻塞只允许等待两秒，不阻止更新失败恢复及再次退出', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let flushes = 0, quits = 0
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => true, prepareForExit() {}, closeAllWindows() {},
    quitApplication() { quits++ }, recoverAfterFailedUpdateInstall: async () => true,
    flushLogs() { flushes++; return flushes === 1 ? new Promise<void>(() => {}) : Promise.reject(new Error('log unavailable')) },
  })
  const installing = coordinator.prepareUpdateInstall()
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  t.mock.timers.tick(2000)
  assert.deepEqual(await installing, { status: 'ready_to_install' })
  assert.equal(await coordinator.handleUpdateInstallerFailure(new Error('installer failed')), true)
  assert.equal((await coordinator.requestApplicationExit('tray')).coreStopped, true)
  assert.equal(flushes, 2)
  assert.equal(quits, 1)
})

test('安装器启动失败后恢复应用并允许重新准备安装', async () => {
  let shutdownCalls = 0
  let prepareCalls = 0
  let recoveryCalls = 0
  let closeCalls = 0
  let quitCalls = 0
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => {
      shutdownCalls += 1
      return true
    },
    prepareForExit: () => {
      prepareCalls += 1
    },
    recoverAfterFailedUpdateInstall: async () => {
      recoveryCalls += 1
      return true
    },
    closeAllWindows: () => {
      closeCalls += 1
    },
    quitApplication: () => {
      quitCalls += 1
    },
  })

  assert.deepEqual(
    await coordinator.prepareUpdateInstall(),
    { status: 'ready_to_install' },
  )
  assert.equal(coordinator.isApplicationExiting(), false)
  assert.equal(
    await coordinator.handleUpdateInstallerFailure(new Error('launch failed')),
    true,
  )
  assert.equal(recoveryCalls, 1)
  assert.equal(closeCalls, 0)
  assert.equal(quitCalls, 0)

  assert.deepEqual(
    await coordinator.prepareUpdateInstall(),
    { status: 'ready_to_install' },
  )
  assert.equal(shutdownCalls, 2)
  assert.equal(prepareCalls, 2)
})

test('窗口退出已开始时不再恢复安装失败事务', async () => {
  let recoveryCalls = 0
  let shutdownCalls = 0
  let closeCalls = 0
  let quitCalls = 0
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => {
      shutdownCalls += 1
      return true
    },
    prepareForExit: () => undefined,
    recoverAfterFailedUpdateInstall: async () => {
      recoveryCalls += 1
      return true
    },
    closeAllWindows: () => {
      closeCalls += 1
    },
    quitApplication: () => {
      quitCalls += 1
    },
  })

  await coordinator.prepareUpdateInstall()
  let prevented = false
  assert.equal(coordinator.handleBeforeQuit({
    preventDefault: () => {
      prevented = true
    },
  }), true)
  assert.equal(prevented, false)
  assert.equal(coordinator.isApplicationExiting(), true)
  assert.equal(
    await coordinator.handleUpdateInstallerFailure(new Error('late failure')),
    false,
  )
  assert.equal(recoveryCalls, 0)
  assert.equal(shutdownCalls, 2)
  assert.equal(closeCalls, 1)
  assert.equal(quitCalls, 1)
})

test('安装失败恢复不成功时安全退出应用', async () => {
  let closeCalls = 0
  let quitCalls = 0
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => true,
    prepareForExit: () => undefined,
    recoverAfterFailedUpdateInstall: async () => false,
    closeAllWindows: () => {
      closeCalls += 1
    },
    quitApplication: () => {
      quitCalls += 1
    },
  })

  await coordinator.prepareUpdateInstall()
  assert.equal(
    await coordinator.handleUpdateInstallerFailure(new Error('launch failed')),
    false,
  )
  assert.equal(coordinator.isApplicationExiting(), true)
  assert.equal(closeCalls, 1)
  assert.equal(quitCalls, 1)
})

test('恢复失败被阻断工作区的诊断窗口接管后保留应用，用户仍可退出', async () => {
  let closeCalls = 0
  let quitCalls = 0
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => true,
    prepareForExit: () => undefined,
    recoverAfterFailedUpdateInstall: async () => { throw new Error('DB_VERSION_TOO_NEW') },
    showRecoveryFailure: () => true,
    closeAllWindows: () => { closeCalls += 1 },
    quitApplication: () => { quitCalls += 1 },
  })
  await coordinator.prepareUpdateInstall()
  assert.equal(await coordinator.handleUpdateInstallerFailure(new Error('installer')), false)
  assert.equal(coordinator.isApplicationExiting(), false)
  assert.equal(closeCalls, 0)
  assert.equal(quitCalls, 0)
  await coordinator.requestApplicationExit('main_window')
  assert.equal(closeCalls, 1)
  assert.equal(quitCalls, 1)
})

test('安装失败恢复仍在等待时，退出立即关闭 Core 并让恢复收口', async () => {
  let finishRecovery: (recovered: boolean) => void = () => undefined
  const recovering = new Promise<boolean>((resolve) => { finishRecovery = resolve })
  let shutdownCalls = 0
  let closeCalls = 0
  let quitCalls = 0
  const coordinator = new AppExitCoordinator({
    shutdownCore: async (reason) => {
      shutdownCalls += 1
      if (reason === 'frontend_exit') finishRecovery(false)
      return true
    },
    recoverAfterFailedUpdateInstall: () => recovering,
    prepareForExit: () => undefined,
    closeAllWindows: () => { closeCalls += 1 },
    quitApplication: () => { quitCalls += 1 },
  })
  await coordinator.prepareUpdateInstall()
  const recovery = coordinator.handleUpdateInstallerFailure(new Error('installer failed'))
  const exiting = coordinator.requestApplicationExit('main_window')
  assert.equal(shutdownCalls, 2)
  assert.equal(await recovery, false)
  assert.equal((await exiting).coreStopped, true)
  assert.equal(closeCalls, 1)
  assert.equal(quitCalls, 1)
})
