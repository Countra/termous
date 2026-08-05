import assert from 'node:assert/strict'
import test from 'node:test'
import type { UpdateSnapshot } from '#common/contracts'
import { createDevelopmentUpdateSimulation } from '../features/update/developmentUpdateSimulation.ts'
import {
  connectDevelopmentUpdateSimulationChannel,
  isDevelopmentUpdateSimulationSnapshot,
} from '../features/update/developmentUpdateSimulationChannel.ts'
import {
  mergeUpdateWindowBootstrap,
  mergeUpdateWindowSnapshot,
  resolveUpdateWindowPrimaryAction,
} from '../features/update/updateWindowUiState.ts'

function browserHarness() {
  const opened: string[] = []
  const features: string[] = []
  let closed = 0
  const browserWindow = {
    location: new URL('http://127.0.0.1:5191/?termous-update-simulation=1'),
    open: (url?: string | URL, _target?: string, featureText?: string) => {
      opened.push(String(url))
      features.push(featureText ?? '')
      return {} as Window
    },
    close: () => {
      closed += 1
    },
  } as unknown as Pick<Window, 'open' | 'close' | 'location'>
  return {
    browserWindow,
    features,
    opened,
    get closed() {
      return closed
    },
  }
}

test('开发模拟必须同时满足编译期开发门禁和显式查询开关', () => {
  const browser = browserHarness()
  assert.equal(
    createDevelopmentUpdateSimulation(
      false,
      '?termous-update-simulation=1',
      browser.browserWindow,
    ),
    null,
  )
  assert.equal(
    createDevelopmentUpdateSimulation(
      true,
      '?termous-update-simulation=0',
      browser.browserWindow,
    ),
    null,
  )
  const simulation = createDevelopmentUpdateSimulation(
    true,
    '?termous-update-simulation=1&update-phase=available',
    browser.browserWindow,
  )
  assert.ok(simulation)
  assert.ok(
    ['win32', 'darwin', 'linux', 'development']
      .includes(simulation.buildInfo.platform),
  )
})

test('开发模拟保持状态、代际、偏好和下载进度单调', async () => {
  const browser = browserHarness()
  const simulation = createDevelopmentUpdateSimulation(
    true,
    '?termous-update-simulation=1&update-phase=available',
    browser.browserWindow,
  )
  assert.ok(simulation)
  const states: UpdateSnapshot[] = []
  const remove = simulation.mainBridge.subscribe((snapshot) => {
    states.push(snapshot)
  })
  const preferences = await simulation.mainBridge.setPreferences({
    automatic_download: true,
  })
  assert.equal(preferences.automatic_download, true)
  assert.ok(preferences.revision > 1)

  const downloaded = await simulation.updateWindowBridge.download()
  assert.equal(downloaded.phase, 'downloaded')
  assert.equal(downloaded.progress?.percent, 100)
  for (let index = 1; index < states.length; index += 1) {
    assert.ok(states[index].state_seq > states[index - 1].state_seq)
    if (
      states[index].operation_generation
      === states[index - 1].operation_generation
      && states[index].progress
      && states[index - 1].progress
    ) {
      assert.ok(
        states[index].progress!.percent
        >= states[index - 1].progress!.percent,
      )
    }
  }
  remove()
})

test('开发更新窗口不会访问外部下载页或进入真实安装路径', async () => {
  const browser = browserHarness()
  const simulation = createDevelopmentUpdateSimulation(
    true,
    '?termous-update-simulation=1&update-phase=downloaded',
    browser.browserWindow,
  )
  assert.ok(simulation)

  assert.deepEqual(await simulation.updateWindowBridge.getApplicationInfo(), {
    product_name: 'Termous',
    version: '0.0.1',
    platform: simulation.buildInfo.platform,
    arch: 'x64',
    packaged: false,
  })
  const confirmation = await simulation.updateWindowBridge.prepareInstall()
  const failed = await simulation.updateWindowBridge.install(
    confirmation.confirmation_token,
  )
  assert.equal(failed.phase, 'error')
  assert.equal(failed.error_code, 'UPDATE_INSTALL_START_FAILED')
  assert.equal(browser.closed, 0)

  const retryConfirmation = await simulation.updateWindowBridge.prepareInstall()
  assert.equal(retryConfirmation.state_seq, failed.state_seq)
  const retryFailed = await simulation.updateWindowBridge.install(
    retryConfirmation.confirmation_token,
  )
  assert.equal(retryFailed.phase, 'error')
  assert.equal(retryFailed.error_code, 'UPDATE_INSTALL_START_FAILED')
  assert.ok(retryFailed.state_seq > failed.state_seq)
})

test('主界面的更新入口只打开同源开发更新 surface', async () => {
  const browser = browserHarness()
  const simulation = createDevelopmentUpdateSimulation(
    true,
    '?termous-update-simulation=1&update-phase=available',
    browser.browserWindow,
  )
  assert.ok(simulation)

  assert.equal(await simulation.mainBridge.openWindow(), true)
  assert.equal(browser.opened.length, 1)
  const target = new URL(browser.opened[0])
  assert.equal(target.origin, 'http://127.0.0.1:5191')
  assert.equal(target.searchParams.get('surface'), 'update')
  assert.equal(target.searchParams.get('termous-update-simulation'), '1')
  assert.ok(target.searchParams.get('update-simulation-id'))
  assert.ok(target.searchParams.get('update-state-actor'))
  assert.equal(target.searchParams.get('update-owner'), '1')
  assert.ok(target.searchParams.get('update-owner-actor'))
  assert.equal(target.searchParams.has('update-intent'), false)
  assert.equal(target.searchParams.get('update-state-seq'), '1')
  assert.equal(target.searchParams.get('update-generation'), '1')
  assert.match(browser.features[0] ?? '', /width=720,height=700/)
})

test('开发跨窗口通道拒绝不完整或越界的状态快照', () => {
  assert.equal(isDevelopmentUpdateSimulationSnapshot({
    state_seq: 1,
    operation_generation: 1,
    phase: 'available',
  }), false)
  assert.equal(isDevelopmentUpdateSimulationSnapshot({
    state_seq: Number.MAX_SAFE_INTEGER + 1,
    operation_generation: 1,
    phase: 'available',
  }), false)
  assert.equal(isDevelopmentUpdateSimulationSnapshot({
    state_seq: 1,
    operation_generation: 1,
    phase: 'available',
    current_version: '0.0.1',
    available_version: '0.0.2',
    release_name: null,
    release_date: null,
    release_notes: null,
    progress: null,
    checked_at: null,
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: null,
      revision: 1,
    },
    next_automatic_check_at: null,
  }), true)
})

test('跨窗口下载中修改偏好不会取消下载或回退进度', async () => {
  const restoreWindow = installFakeBroadcastWindow()
  try {
    const mainBrowser = browserHarness()
    const main = createDevelopmentUpdateSimulation(
      true,
      [
        '?termous-update-simulation=1',
        'update-phase=available',
        'update-simulation-id=shared-simulation-123',
      ].join('&'),
      mainBrowser.browserWindow,
    )
    assert.ok(main)
    await main.mainBridge.openWindow()
    const updateTarget = new URL(mainBrowser.opened[0])
    const updateBrowser = browserHarness()
    const update = createDevelopmentUpdateSimulation(
      true,
      updateTarget.search,
      updateBrowser.browserWindow,
    )
    assert.ok(update)
    const download = update.updateWindowBridge.download()

    const observed: UpdateSnapshot[] = []
    const remove = main.mainBridge.subscribe((snapshot) => {
      observed.push(snapshot)
    })
    await waitFor(async () => (
      (await main.updateWindowBridge.getState()).phase === 'downloading'
    ))
    await main.mainBridge.setPreferences({ automatic_download: true })
    await waitFor(async () => (
      (await update.updateWindowBridge.getState()).phase === 'downloaded'
      && (await main.updateWindowBridge.getState()).phase === 'downloaded'
    ))
    await download

    const downloaded = await update.updateWindowBridge.getState()
    assert.equal(downloaded.preferences.automatic_download, true)
    const progress = observed
      .filter((snapshot) => snapshot.progress)
      .map((snapshot) => snapshot.progress!.percent)
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index] >= progress[index - 1])
    }
    remove()
  } finally {
    restoreWindow()
  }
})

test('不同运行标识的开发模拟不会互相覆盖', async () => {
  const restoreWindow = installFakeBroadcastWindow()
  try {
    const first = createDevelopmentUpdateSimulation(
      true,
      [
        '?termous-update-simulation=1',
        'update-phase=available',
        'update-simulation-id=isolated-simulation-a',
      ].join('&'),
      browserHarness().browserWindow,
    )
    const second = createDevelopmentUpdateSimulation(
      true,
      [
        '?termous-update-simulation=1',
        'update-phase=available',
        'update-simulation-id=isolated-simulation-b',
      ].join('&'),
      browserHarness().browserWindow,
    )
    assert.ok(first)
    assert.ok(second)

    await first.updateWindowBridge.download()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
    assert.equal(
      (await first.updateWindowBridge.getState()).phase,
      'downloaded',
    )
    assert.equal(
      (await second.updateWindowBridge.getState()).phase,
      'available',
    )
  } finally {
    restoreWindow()
  }
})

test('开发更新副本以 owner 的同序号权威快照覆盖 URL 合成状态', async () => {
  const restoreWindow = installFakeBroadcastWindow()
  try {
    const mainBrowser = browserHarness()
    const main = createDevelopmentUpdateSimulation(
      true,
      [
        '?termous-update-simulation=1',
        'update-phase=downloaded',
        'update-simulation-id=authoritative-simulation-123',
      ].join('&'),
      mainBrowser.browserWindow,
    )
    assert.ok(main)
    const confirmation = await main.updateWindowBridge.prepareInstall()
    await main.updateWindowBridge.install(confirmation.confirmation_token)
    assert.equal(
      (await main.updateWindowBridge.getState()).error_code,
      'UPDATE_INSTALL_START_FAILED',
    )

    await main.mainBridge.openWindow()
    const replica = createDevelopmentUpdateSimulation(
      true,
      new URL(mainBrowser.opened[0]).search,
      browserHarness().browserWindow,
    )
    assert.ok(replica)
    let rendered = await replica.updateWindowBridge.getBootstrap()
    const removeBootstrap = replica.updateWindowBridge.onBootstrapChanged(
      (bootstrap) => {
        rendered = mergeUpdateWindowBootstrap(rendered, bootstrap)
      },
    )
    const removeState = replica.updateWindowBridge.subscribe((snapshot) => {
      rendered = {
        ...rendered,
        snapshot: mergeUpdateWindowSnapshot(rendered.snapshot, snapshot),
      }
    })
    await waitFor(async () => (
      (await replica.updateWindowBridge.getState()).error_code
      === 'UPDATE_INSTALL_START_FAILED'
    ))
    assert.equal(
      (await replica.updateWindowBridge.getState()).error_message,
      '开发模拟不会启动真实安装程序',
    )
    await waitFor(async () => (
      rendered.snapshot.error_code === 'UPDATE_INSTALL_START_FAILED'
    ))
    assert.equal(
      resolveUpdateWindowPrimaryAction(rendered.snapshot),
      'retry_install',
    )
    removeState()
    removeBootstrap()
  } finally {
    restoreWindow()
  }
})

test('下载中重开开发更新窗口不会保留 URL 合成的固定进度', async () => {
  const restoreWindow = installFakeBroadcastWindow()
  try {
    const mainBrowser = browserHarness()
    const main = createDevelopmentUpdateSimulation(
      true,
      [
        '?termous-update-simulation=1',
        'update-phase=available',
        'update-simulation-id=progress-simulation-123',
      ].join('&'),
      mainBrowser.browserWindow,
    )
    assert.ok(main)
    const download = main.updateWindowBridge.download()
    await waitFor(async () => (
      (await main.updateWindowBridge.getState()).progress?.percent === 8
    ))

    await main.mainBridge.openWindow()
    const replica = createDevelopmentUpdateSimulation(
      true,
      new URL(mainBrowser.opened[0]).search,
      browserHarness().browserWindow,
    )
    assert.ok(replica)
    await waitFor(async () => (
      (await replica.updateWindowBridge.getState()).progress?.percent === 8
    ))
    assert.equal(
      (await replica.updateWindowBridge.getState()).progress?.transferred,
      (await main.updateWindowBridge.getState()).progress?.transferred,
    )
    await main.updateWindowBridge.cancelDownload()
    await download
  } finally {
    restoreWindow()
  }
})

test('开发跨窗口通道进入 bfcache 后保持连接并在真正卸载时关闭', async () => {
  const lifecycle = installLifecycleBroadcastWindow()
  const snapshot = createSimulationSnapshot()
  try {
    const owner = connectDevelopmentUpdateSimulationChannel({
      actorId: 'owner-actor-123',
      getSnapshot: () => snapshot,
      handleAction: async () => snapshot,
      onSnapshot: () => undefined,
      ownerActorId: 'owner-actor-123',
      simulationId: 'lifecycle-simulation-123',
    })
    const replica = connectDevelopmentUpdateSimulationChannel({
      actorId: 'replica-actor-123',
      getSnapshot: () => snapshot,
      onSnapshot: () => undefined,
      ownerActorId: 'owner-actor-123',
      simulationId: 'lifecycle-simulation-123',
    })

    lifecycle.dispatchPageHide(true)
    assert.equal((await replica.requestAction({ type: 'check' })).phase, 'available')

    lifecycle.dispatchPageHide(false)
    await assert.rejects(
      replica.requestAction({ type: 'check' }),
      /development_update_simulation_channel_closed/,
    )
    owner.close()
    replica.close()
  } finally {
    lifecycle.restore()
  }
})

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMilliseconds = 2_000,
) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25)
    })
  }
  throw new Error('等待开发更新模拟状态超时')
}

class FakeBroadcastChannel {
  static readonly channels = new Map<string, Set<FakeBroadcastChannel>>()

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  private readonly name: string

  constructor(name: string) {
    this.name = name
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  postMessage(message: unknown) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this) {
        continue
      }
      queueMicrotask(() => {
        peer.onmessage?.({
          data: structuredClone(message),
        } as MessageEvent<unknown>)
      })
    }
  }

  close() {
    const peers = FakeBroadcastChannel.channels.get(this.name)
    peers?.delete(this)
    if (peers?.size === 0) {
      FakeBroadcastChannel.channels.delete(this.name)
    }
  }

  static reset() {
    FakeBroadcastChannel.channels.clear()
  }
}

function installFakeBroadcastWindow() {
  const scope = globalThis as typeof globalThis & { window?: Window }
  const previous = Object.getOwnPropertyDescriptor(scope, 'window')
  Object.defineProperty(scope, 'window', {
    configurable: true,
    value: {
      BroadcastChannel: FakeBroadcastChannel as unknown as typeof BroadcastChannel,
      addEventListener: () => undefined,
      clearTimeout: globalThis.clearTimeout,
      matchMedia: () => ({ matches: false }),
      setTimeout: globalThis.setTimeout,
    },
  })
  return () => {
    FakeBroadcastChannel.reset()
    if (previous) {
      Object.defineProperty(scope, 'window', previous)
    } else {
      Reflect.deleteProperty(scope, 'window')
    }
  }
}

function installLifecycleBroadcastWindow() {
  const scope = globalThis as typeof globalThis & { window?: Window }
  const previous = Object.getOwnPropertyDescriptor(scope, 'window')
  const pageHideListeners = new Set<(event: PageTransitionEvent) => void>()
  Object.defineProperty(scope, 'window', {
    configurable: true,
    value: {
      BroadcastChannel: FakeBroadcastChannel as unknown as typeof BroadcastChannel,
      addEventListener: (
        type: string,
        listener: (event: PageTransitionEvent) => void,
      ) => {
        if (type === 'pagehide') {
          pageHideListeners.add(listener)
        }
      },
      clearTimeout: globalThis.clearTimeout,
      matchMedia: () => ({ matches: false }),
      removeEventListener: (
        type: string,
        listener: (event: PageTransitionEvent) => void,
      ) => {
        if (type === 'pagehide') {
          pageHideListeners.delete(listener)
        }
      },
      setTimeout: globalThis.setTimeout,
    },
  })
  return {
    dispatchPageHide: (persisted: boolean) => {
      const event = { persisted } as PageTransitionEvent
      for (const listener of [...pageHideListeners]) {
        listener(event)
      }
    },
    restore: () => {
      FakeBroadcastChannel.reset()
      if (previous) {
        Object.defineProperty(scope, 'window', previous)
      } else {
        Reflect.deleteProperty(scope, 'window')
      }
    },
  }
}

function createSimulationSnapshot(): UpdateSnapshot {
  return {
    state_seq: 1,
    operation_generation: 1,
    phase: 'available',
    current_version: '0.0.1',
    available_version: '0.0.2',
    release_name: 'Termous 0.0.2',
    release_date: '2026-07-25T08:00:00.000Z',
    release_notes: '本地模拟版本',
    progress: null,
    checked_at: null,
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: null,
      revision: 1,
    },
    next_automatic_check_at: null,
  }
}
