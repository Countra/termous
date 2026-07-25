import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AppExitCoordinator,
  type AppExitCoordinatorDependencies,
} from '../../electron/appExitCoordinator.ts'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function coordinatorHarness(overrides: Partial<AppExitCoordinatorDependencies> = {}) {
  const events: string[] = []
  const dependencies: AppExitCoordinatorDependencies = {
    shutdownCore: async (reason) => {
      events.push(`shutdown:${reason}`)
      return true
    },
    prepareForExit: () => {
      events.push('prepare')
    },
    closeAllWindows: () => {
      events.push('close-windows')
    },
    quitApplication: () => {
      events.push('quit')
    },
    reportError: (event) => {
      events.push(`error:${event}`)
    },
    ...overrides,
  }
  return {
    coordinator: new AppExitCoordinator(dependencies),
    events,
  }
}

test('普通退出关闭全部窗口并请求应用退出，Core 超时不阻塞退出', async () => {
  const { coordinator, events } = coordinatorHarness({
    shutdownCore: async (reason) => {
      events.push(`shutdown:${reason}`)
      return false
    },
  })

  const result = await coordinator.requestApplicationExit('tray')

  assert.deepEqual(result, {
    mode: 'application_exit',
    source: 'tray',
    coreStopped: false,
  })
  assert.deepEqual(events, [
    'shutdown:frontend_exit',
    'prepare',
    'close-windows',
    'quit',
  ])
})

test('并发普通退出复用同一事务且清理只执行一次', async () => {
  const shutdown = deferred<boolean>()
  let shutdownCalls = 0
  const { coordinator, events } = coordinatorHarness({
    shutdownCore: () => {
      shutdownCalls += 1
      return shutdown.promise
    },
  })

  const first = coordinator.requestApplicationExit('main_window')
  const second = coordinator.requestApplicationExit('window_all_closed')
  assert.equal(first, second)
  assert.equal(shutdownCalls, 1)
  assert.equal(coordinator.isApplicationExiting(), true)
  assert.equal(coordinator.isExitCommitted(), false)

  shutdown.resolve(true)
  await Promise.all([first, second])
  assert.equal(shutdownCalls, 1)
  assert.deepEqual(events, ['prepare', 'close-windows', 'quit'])
})

test('普通退出请求在 Core 收口前同步阻止创建或显示新窗口', async () => {
  const shutdown = deferred<boolean>()
  const { coordinator } = coordinatorHarness({
    shutdownCore: () => shutdown.promise,
  })

  const exiting = coordinator.requestApplicationExit('tray')

  assert.equal(coordinator.isApplicationExiting(), true)
  assert.equal(coordinator.isExitCommitted(), false)

  shutdown.resolve(true)
  await exiting
  assert.equal(coordinator.isApplicationExiting(), true)
  assert.equal(coordinator.isExitCommitted(), true)
})

test('更新安装必须等待 Core 确认退出且并发请求复用同一事务', async () => {
  const shutdown = deferred<boolean>()
  let shutdownCalls = 0
  const { coordinator, events } = coordinatorHarness({
    shutdownCore: (reason) => {
      events.push(`shutdown:${reason}`)
      shutdownCalls += 1
      return shutdown.promise
    },
  })

  const first = coordinator.prepareUpdateInstall()
  const second = coordinator.prepareUpdateInstall()
  assert.equal(first, second)
  assert.deepEqual(events, ['shutdown:application_update'])

  shutdown.resolve(true)
  assert.deepEqual(await first, { status: 'ready_to_install' })
  assert.equal(shutdownCalls, 1)
  assert.deepEqual(events, ['shutdown:application_update', 'prepare'])
})

test('Core 未退出时拒绝启动安装器并允许再次尝试', async () => {
  let shutdownCalls = 0
  const { coordinator, events } = coordinatorHarness({
    shutdownCore: async (reason) => {
      events.push(`shutdown:${reason}`)
      shutdownCalls += 1
      return shutdownCalls > 1
    },
  })

  assert.deepEqual(await coordinator.prepareUpdateInstall(), {
    status: 'core_shutdown_failed',
  })
  assert.deepEqual(await coordinator.prepareUpdateInstall(), {
    status: 'ready_to_install',
  })
  assert.deepEqual(events, [
    'shutdown:application_update',
    'shutdown:application_update',
    'prepare',
  ])
})

test('before-quit 在退出未提交时拦截，提交后直接放行', async () => {
  const shutdown = deferred<boolean>()
  const { coordinator } = coordinatorHarness({
    shutdownCore: () => shutdown.promise,
  })
  let prevented = 0
  const event = { preventDefault: () => { prevented += 1 } }

  assert.equal(coordinator.handleBeforeQuit(event), false)
  assert.equal(coordinator.handleBeforeQuit(event), false)
  assert.equal(prevented, 2)

  shutdown.resolve(true)
  await coordinator.requestApplicationExit('before_quit')
  assert.equal(coordinator.handleBeforeQuit(event), true)
  assert.equal(prevented, 2)
})

test('更新窗口可独立关闭，主窗口只在应用退出提交后放行', async () => {
  const { coordinator } = coordinatorHarness()

  assert.equal(coordinator.canCloseWindow('update'), true)
  assert.equal(coordinator.canCloseWindow('main'), false)
  assert.equal(coordinator.canCloseWindow('splash'), false)

  await coordinator.requestApplicationExit('main_window')
  assert.equal(coordinator.canCloseWindow('main'), true)
  assert.equal(coordinator.canCloseWindow('splash'), true)
})

test('安装器启动异常时记录错误并完成安全退出', () => {
  const installError = new Error('installer failed')
  const { coordinator, events } = coordinatorHarness()

  coordinator.handleUpdateInstallerFailure(installError)

  assert.deepEqual(events, [
    'error:update-installer-launch-failed',
    'close-windows',
    'quit',
  ])
})
