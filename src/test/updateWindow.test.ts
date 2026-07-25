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
  private listeners = new Map<string, Array<() => void>>()

  close() {
    this.closeCalls += 1
    this.destroyed = true
    this.emit('closed')
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

  on(event: 'closed', listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  once(event: 'ready-to-show', listener: () => void) {
    this.listeners.set(event, [listener])
  }

  restore() {
    this.minimized = false
  }

  show() {
    this.showCalls += 1
  }

  emit(event: string) {
    const listeners = this.listeners.get(event) ?? []
    this.listeners.delete(event)
    for (const listener of listeners) {
      listener()
    }
  }
}

function controller(overrides: Partial<ConstructorParameters<typeof UpdateWindowController>[0]> = {}) {
  const windows: FakeWindow[] = []
  let downloadCalls = 0
  const instance = new UpdateWindowController({
    createWindow: () => {
      const target = new FakeWindow()
      windows.push(target)
      return target
    },
    getSnapshot: () => ({ state_seq: 1 }),
    initialLanguage: 'zh-CN',
    initialTheme: 'dark',
    onStartDownload: () => {
      downloadCalls += 1
    },
    platform: 'win32',
    preloadPath: 'D:\\app\\update-preload.cjs',
    rendererFilePath: 'D:\\app\\dist\\index.html',
    ...overrides,
  })
  return { instance, windows, downloadCalls: () => downloadCalls }
}

test('重复打开只复用一个窗口并在加载完成后启动一次下载', async () => {
  const subject = controller()
  const first = subject.instance.open('inspect') as FakeWindow
  const second = subject.instance.open('start_download')

  assert.equal(first, second)
  assert.equal(subject.windows.length, 1)
  assert.equal(subject.downloadCalls(), 0)

  first.webContents.emit('did-finish-load')
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(subject.downloadCalls(), 1)
})

test('下载派发进行中重复 start_download 只聚焦窗口且不会排队重启', async () => {
  const pending = deferred<void>()
  let downloadCalls = 0
  const subject = controller({
    onStartDownload: () => {
      downloadCalls += 1
      return pending.promise
    },
  })
  const target = subject.instance.open('start_download') as FakeWindow
  target.webContents.emit('did-finish-load')
  await Promise.resolve()

  subject.instance.open('start_download')
  subject.instance.open('start_download')
  assert.equal(downloadCalls, 1)

  pending.resolve()
  await pending.promise
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(downloadCalls, 1)
  assert.equal(subject.windows.length, 1)
  assert.equal(target.focusCalls >= 2, true)
})

test('下载派发失败后不会消费重复点击留下的隐式重试', async () => {
  const pending = deferred<void>()
  const errors: unknown[] = []
  let downloadCalls = 0
  const subject = controller({
    onError: (error) => {
      errors.push(error)
    },
    onStartDownload: () => {
      downloadCalls += 1
      return pending.promise
    },
  })
  const target = subject.instance.open('start_download') as FakeWindow
  target.webContents.emit('did-finish-load')
  await Promise.resolve()
  subject.instance.open('start_download')

  pending.reject(new Error('下载失败'))
  await pending.promise.catch(() => undefined)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(downloadCalls, 1)
  assert.equal(errors.length, 1)
})

test('下载取消完成后不会自动重新派发重复的 start_download', async () => {
  const pending = deferred<{ canceled: boolean }>()
  let downloadCalls = 0
  const subject = controller({
    onStartDownload: () => {
      downloadCalls += 1
      return pending.promise
    },
  })
  const target = subject.instance.open('start_download') as FakeWindow
  target.webContents.emit('did-finish-load')
  await Promise.resolve()
  subject.instance.open('start_download')

  pending.resolve({ canceled: true })
  await pending.promise
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(downloadCalls, 1)
})

test('关闭更新窗口不触碰下载事务且下次可重新创建', () => {
  const subject = controller()
  const first = subject.instance.open('inspect') as FakeWindow
  assert.equal(subject.instance.close(), true)
  assert.equal(first.closeCalls, 1)

  const second = subject.instance.open('inspect')
  assert.notEqual(first, second)
  assert.equal(subject.windows.length, 2)
})

test('窗口拒绝外部导航和新窗口，仅允许可信 update surface', () => {
  const subject = controller({ devServerURL: 'http://127.0.0.1:5191/' })
  const target = subject.instance.open('inspect') as FakeWindow
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
  const target = subject.instance.open('inspect') as FakeWindow
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
