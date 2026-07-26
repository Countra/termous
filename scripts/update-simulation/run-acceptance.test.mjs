import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  hasChildProcessExited,
  runLocalUpdateSimulationAcceptance,
  UpdateSimulationRunnerError,
  waitForChildExitWithTimeout,
} from './run-acceptance.mjs'

const downloadedAsset = Object.freeze({
  name: 'Termous-Update-Simulation-0.0.2.exe',
  size: 4096,
  sha512: 'simulation-sha512',
})
const fixture = Object.freeze({
  baselineExecutable: 'C:\\fixtures\\TermousUpdateSimulation.exe',
  currentVersion: '0.0.1',
  downloadedAsset,
  feedRoot: 'C:\\fixtures\\candidate',
  targetVersion: '0.0.2',
})
const passingReport = Object.freeze({
  result: 'passed',
  current_version: '0.0.1',
  target_version: '0.0.2',
  state_events: 12,
  maximum_state_seq: 18,
  scenarios: [
    'redirect_external',
    'metadata_404',
    'disconnect',
    'hash_mismatch',
    'cancel',
    'window_reopen',
    'download',
  ],
  downloaded_asset: downloadedAsset,
})

test('子进程以退出码或信号结束都视为终态', () => {
  assert.equal(
    hasChildProcessExited({ exitCode: 0, signalCode: null }),
    true,
  )
  assert.equal(
    hasChildProcessExited({ exitCode: null, signalCode: 'SIGTERM' }),
    true,
  )
  assert.equal(
    hasChildProcessExited({ exitCode: null, signalCode: null }),
    false,
  )
})

test('辅助清理进程等待达到预算后返回超时终态', async () => {
  const child = new EventEmitter()
  Object.assign(child, {
    exitCode: null,
    signalCode: null,
  })
  assert.equal(await waitForChildExitWithTimeout(child, 5), null)
  assert.equal(child.listenerCount('error'), 0)
  assert.equal(child.listenerCount('exit'), 0)
})

test('本地验收成功后按逆序停止子进程并清理运行目录', async () => {
  const events = []
  const feed = createManagedProcess('feed', {
    ready: Promise.resolve(),
  }, events)
  const electron = createManagedProcess('electron', {
    completed: Promise.resolve({ code: 0, signal: null }),
  }, events)
  const result = await runLocalUpdateSimulationAcceptance({
    timeoutMs: 1_000,
  }, createDependencies({
    events,
    feed,
    electron,
  }))

  assert.deepEqual(result, passingReport)
  assert.deepEqual(events, [
    'resolve-fixture',
    'create-runtime',
    'launch-feed',
    'launch-electron',
    'read-report',
    'stop-electron',
    'stop-feed',
    'remove-runtime',
  ])
})

test('更新模拟程序异常退出时仍清理两个子进程和运行目录', async () => {
  const events = []
  const feed = createManagedProcess('feed', {
    ready: Promise.resolve(),
  }, events)
  const electron = createManagedProcess('electron', {
    completed: Promise.resolve({ code: 7, signal: null }),
  }, events)

  await assert.rejects(
    runLocalUpdateSimulationAcceptance({
      timeoutMs: 1_000,
    }, createDependencies({
      events,
      feed,
      electron,
    })),
    (error) => (
      error instanceof UpdateSimulationRunnerError
      && error.code === 'electron_failed'
    ),
  )
  assert.deepEqual(events.slice(-3), [
    'stop-electron',
    'stop-feed',
    'remove-runtime',
  ])
  assert.equal(events.includes('read-report'), false)
})

test('简化或缺失关键字段的成功报告不能通过外层验收', async () => {
  const events = []
  const feed = createManagedProcess('feed', {
    ready: Promise.resolve(),
  }, events)
  const electron = createManagedProcess('electron', {
    completed: Promise.resolve({ code: 0, signal: null }),
  }, events)

  await assert.rejects(
    runLocalUpdateSimulationAcceptance({
      timeoutMs: 1_000,
    }, createDependencies({
      events,
      feed,
      electron,
      report: {
        ...passingReport,
        scenarios: ['download'],
      },
    })),
    /报告未通过契约校验/,
  )
  assert.deepEqual(events.slice(-3), [
    'stop-electron',
    'stop-feed',
    'remove-runtime',
  ])
})

test('本地验收超时会终止未完成的子进程并清理运行目录', async () => {
  const events = []
  const feed = createManagedProcess('feed', {
    ready: Promise.resolve(),
  }, events)
  const electron = createManagedProcess('electron', {
    completed: new Promise(() => undefined),
  }, events)

  await assert.rejects(
    runLocalUpdateSimulationAcceptance({
      timeoutMs: 10,
    }, createDependencies({
      events,
      feed,
      electron,
    })),
    (error) => (
      error instanceof UpdateSimulationRunnerError
      && error.code === 'timeout'
    ),
  )
  assert.deepEqual(events.slice(-3), [
    'stop-electron',
    'stop-feed',
    'remove-runtime',
  ])
})

test('收到中断信号时停止完整子进程链并移除信号监听', async () => {
  const events = []
  const signalTarget = new EventEmitter()
  const feed = createManagedProcess('feed', {
    ready: Promise.resolve(),
  }, events)
  const electron = createManagedProcess('electron', {
    completed: new Promise(() => undefined),
  }, events)
  let notifyElectronLaunched
  const electronLaunched = new Promise((resolve) => {
    notifyElectronLaunched = resolve
  })
  const dependencies = createDependencies({
    events,
    feed,
    electron,
    signalTarget,
    onElectronLaunched: notifyElectronLaunched,
  })

  const running = runLocalUpdateSimulationAcceptance({
    timeoutMs: 1_000,
  }, dependencies)
  await electronLaunched
  signalTarget.emit('SIGINT')

  await assert.rejects(
    running,
    (error) => (
      error instanceof UpdateSimulationRunnerError
      && error.code === 'interrupted'
      && error.signal === 'SIGINT'
    ),
  )
  assert.deepEqual(events.slice(-3), [
    'stop-electron',
    'stop-feed',
    'remove-runtime',
  ])
  assert.equal(signalTarget.listenerCount('SIGINT'), 0)
  assert.equal(signalTarget.listenerCount('SIGTERM'), 0)
})

function createDependencies(options) {
  return {
    environment: {},
    signalTarget: options.signalTarget ?? new EventEmitter(),
    resolveFixture: async () => {
      options.events.push('resolve-fixture')
      return fixture
    },
    createRuntimeRoot: async () => {
      options.events.push('create-runtime')
      return 'C:\\runtime\\owned'
    },
    removeRuntimeRoot: async () => {
      options.events.push('remove-runtime')
    },
    launchFeed: ({ environment }) => {
      options.events.push('launch-feed')
      assert.equal(
        environment.TERMOUS_UPDATE_SIMULATION_FEED_ROOT,
        fixture.feedRoot,
      )
      assert.ok(environment.TERMOUS_UPDATE_SIMULATION_TOKEN.length >= 24)
      return options.feed
    },
    launchElectron: () => {
      options.events.push('launch-electron')
      options.onElectronLaunched?.()
      return options.electron
    },
    readReport: async () => {
      options.events.push('read-report')
      return options.report ?? passingReport
    },
  }
}

function createManagedProcess(name, overrides, events) {
  return {
    completed: overrides.completed ?? new Promise(() => undefined),
    ready: overrides.ready ?? Promise.resolve(),
    async stop() {
      events.push(`stop-${name}`)
    },
  }
}
