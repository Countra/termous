import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UpdateWindowController,
  updateSurfaceURL,
  type UpdateBrowserWindowLike,
} from '../../electron/updateWindow.ts'

class FakeWebContents {
  id = 42
  messages: Array<{ channel: string; payload: unknown }> = []
  handlers = new Map<string, Array<(...args: never[]) => void>>()
  openHandler?: (details: { url: string }) => { action: 'deny' }

  isDestroyed() {
    return false
  }

  send(channel: string, payload: unknown) {
    this.messages.push({ channel, payload })
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }) {
    this.openHandler = handler
  }

  on(event: string, listener: (...args: never[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener])
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.handlers.get(event) ?? []) {
      listener(...args as never[])
    }
  }
}

class FakeWindow implements UpdateBrowserWindowLike {
  closeCalls = 0
  destroyed = false
  fileLoads: Array<{ path: string; query?: Record<string, string> }> = []
  focusCalls = 0
  minimized = false
  showCalls = 0
  urlLoads: string[] = []
  webContents = new FakeWebContents()
  private closeListeners: Array<(event: { preventDefault(): void }) => void> = []
  private closedListeners: Array<() => void> = []
  private readyListeners: Array<() => void> = []

  close() {
    this.closeCalls += 1
    let prevented = false
    const event = {
      preventDefault() {
        prevented = true
      },
    }
    for (const listener of this.closeListeners) {
      listener(event)
    }
    if (prevented) {
      return
    }
    this.destroyed = true
    for (const listener of this.closedListeners.splice(0)) {
      listener()
    }
  }

  focus() {
    this.focusCalls += 1
  }

  isDestroyed() {
    return this.destroyed
  }

  isMinimized() {
    return this.minimized
  }

  loadFile(path: string, options?: { query?: Record<string, string> }) {
    this.fileLoads.push({ path, query: options?.query })
    return Promise.resolve()
  }

  loadURL(url: string) {
    this.urlLoads.push(url)
    return Promise.resolve()
  }

  minimize() {
    this.minimized = true
  }

  on(
    event: 'close',
    listener: (event: { preventDefault(): void }) => void,
  ): void
  on(event: 'closed', listener: () => void): void
  on(
    event: 'close' | 'closed',
    listener: (() => void) | ((event: { preventDefault(): void }) => void),
  ) {
    if (event === 'close') {
      this.closeListeners.push(
        listener as (event: { preventDefault(): void }) => void,
      )
      return
    }
    this.closedListeners.push(listener as () => void)
  }

  once(_event: 'ready-to-show', listener: () => void) {
    this.readyListeners = [listener]
  }

  restore() {
    this.minimized = false
  }

  show() {
    this.showCalls += 1
  }

  emitReady() {
    const listeners = this.readyListeners.splice(0)
    for (const listener of listeners) {
      listener()
    }
  }
}

function controller(overrides: Partial<ConstructorParameters<typeof UpdateWindowController>[0]> = {}) {
  const windows: FakeWindow[] = []
  const instance = new UpdateWindowController({
    createWindow: () => {
      const target = new FakeWindow()
      windows.push(target)
      return target
    },
    getSnapshot: () => ({ state_seq: 1 }),
    initialLanguage: 'zh-CN',
    initialTheme: 'dark',
    platform: 'win32',
    preloadPath: 'D:\\app\\update-preload.cjs',
    rendererFilePath: 'D:\\app\\dist\\index.html',
    ...overrides,
  })
  return { instance, windows }
}

test('重复打开只复用一个关于窗口并发布最新状态', () => {
  const subject = controller()
  const first = subject.instance.open() as FakeWindow
  first.webContents.emit('did-finish-load')
  const second = subject.instance.open()

  assert.equal(first, second)
  assert.equal(subject.windows.length, 1)
  assert.equal(first.focusCalls, 1)
  assert.equal(first.webContents.messages.length >= 2, true)
})

test('关闭更新窗口不触碰下载事务且下次可重新创建', () => {
  const subject = controller()
  const first = subject.instance.open() as FakeWindow
  assert.equal(subject.instance.close(), true)
  assert.equal(first.closeCalls, 1)

  const second = subject.instance.open()
  assert.notEqual(first, second)
  assert.equal(subject.windows.length, 2)
})

test('关键安装阶段同时拒绝 IPC 和原生窗口关闭', () => {
  let closeAllowed = false
  const subject = controller({
    canClose: () => closeAllowed,
  })
  const target = subject.instance.open() as FakeWindow

  assert.equal(subject.instance.close(), false)
  assert.equal(target.closeCalls, 0)
  target.close()
  assert.equal(target.destroyed, false)

  closeAllowed = true
  assert.equal(subject.instance.close(), true)
  assert.equal(target.destroyed, true)
})

test('窗口拒绝外部导航和新窗口，仅允许可信 update surface', () => {
  const subject = controller({ devServerURL: 'http://127.0.0.1:5191/' })
  const target = subject.instance.open() as FakeWindow
  const blocked = { prevented: false, preventDefault() { this.prevented = true } }
  const allowed = { prevented: false, preventDefault() { this.prevented = true } }

  target.webContents.emit('will-navigate', blocked, 'https://example.com/?surface=update')
  target.webContents.emit('will-navigate', allowed, updateSurfaceURL('http://127.0.0.1:5191/'))

  assert.equal(blocked.prevented, true)
  assert.equal(allowed.prevented, false)
  assert.deepEqual(target.webContents.openHandler?.({ url: 'https://example.com' }), { action: 'deny' })
})

test('主题和语言通过递增 bootstrap 同步给已加载窗口', () => {
  const subject = controller()
  const target = subject.instance.open() as FakeWindow
  target.webContents.emit('did-finish-load')
  subject.instance.updateAppearance('light', 'en-US')

  const bootstrap = subject.instance.getBootstrap()
  assert.equal(bootstrap.theme, 'light')
  assert.equal(bootstrap.language, 'en-US')
  assert.equal(bootstrap.bootstrap_seq, 2)
  assert.equal(
    target.webContents.messages[target.webContents.messages.length - 1]?.channel,
    'app-update:window-bootstrap-changed',
  )
})
