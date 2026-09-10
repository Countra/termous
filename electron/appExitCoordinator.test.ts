import assert from 'node:assert/strict'
import test from 'node:test'
import { AppExitCoordinator } from './appExitCoordinator.ts'

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
