import assert from 'node:assert/strict'
import test from 'node:test'
import type { App, IpcMain, IpcMainInvokeEvent, LaunchItems, LoginItemSettings } from 'electron'
import { loginItemIPCChannels, type LoginItemResponse } from '#common/contracts'
import { registerLoginItemIPC } from './loginItemIPC.ts'

// 仅注入内存模拟接口；本文件不加载 Electron 主进程，也不读写系统启动项。
function fixture(input: { packaged?: boolean; development?: boolean; platform?: NodeJS.Platform; executablePath?: string } = {}) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => LoginItemResponse>()
  const reads: unknown[] = []
  const writes: unknown[] = []
  let trusted = true
  let writeError = false
  let readError = false
  let apply = true
  const executablePath = input.executablePath ?? 'C:\\Program Files\\Termous\\Termous.exe'
  const state = {
    openAtLogin: false, openAsHidden: false, wasOpenedAtLogin: false,
    wasOpenedAsHidden: false, restoreState: false, status: 'not-registered',
    executableWillLaunchAtLogin: false, launchItems: [],
  } as LoginItemSettings
  const app: Pick<App, 'isPackaged' | 'getLoginItemSettings' | 'setLoginItemSettings'> = {
    isPackaged: input.packaged ?? true,
    getLoginItemSettings(options) {
      reads.push(options)
      if (readError) throw new Error('模拟读取失败')
      if ((input.platform ?? 'win32') === 'win32') {
        // 模拟 Electron 按命令行解析查询路径并筛选启动项，暴露含空格路径的兼容问题。
        const query = options?.path ?? executablePath
        const lookupPath = query.startsWith('"') ? query.slice(1, query.indexOf('"', 1)) : query.split(/\s/u)[0]
        return { ...state, launchItems: state.launchItems.filter((item) => item.path.toLowerCase() === lookupPath.toLowerCase()) }
      }
      return state
    },
    setLoginItemSettings(settings) {
      writes.push(settings)
      if (writeError) throw new Error('模拟写入失败')
      if (!apply) return
      state.openAtLogin = settings.openAtLogin ?? false
      state.launchItems = state.openAtLogin
        ? [{ name: 'dev.termous.app', scope: 'user', enabled: true, path: executablePath, args: [] }]
        : []
    },
  }
  const dispose = registerLoginItemIPC({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as never),
      removeHandler: (channel) => handlers.delete(channel),
    } as Pick<IpcMain, 'handle' | 'removeHandler'>,
    app, platform: input.platform ?? 'win32', development: input.development ?? false,
    executablePath, entryName: 'dev.termous.app',
    isTrustedSender: () => trusted,
  })
  const event = {} as IpcMainInvokeEvent
  return {
    reads, writes, state, handlers, dispose,
    get: () => handlers.get(loginItemIPCChannels.get)!(event),
    set: (value: unknown) => handlers.get(loginItemIPCChannels.setEnabled)!(event, value),
    setTrusted: (value: boolean) => { trusted = value },
    setWriteError: () => { writeError = true },
    setReadError: () => { readError = true },
    rejectChange: () => { apply = false },
  }
}

test('注册和查询不写系统，默认关闭，仅布尔切换使用固定路径和名称', () => {
  const f = fixture()
  assert.deepEqual(f.reads, [])
  assert.deepEqual(f.writes, [])
  assert.deepEqual(f.get(), { ok: true, value: { available: true, enabled: false, unavailable_reason: null, requires_approval: false } })
  assert.deepEqual(f.writes, [])
  const enabled = f.set(true)
  assert.equal(enabled.ok && enabled.value.enabled, true)
  assert.deepEqual(f.writes, [{ openAtLogin: true, enabled: true, name: 'dev.termous.app', path: 'C:\\Program Files\\Termous\\Termous.exe', args: [] }])
  assert.deepEqual(f.reads[0], { path: '"C:\\Program Files\\Termous\\Termous.exe"', args: [] })
  const disabled = f.set(false)
  assert.equal(disabled.ok && disabled.value.enabled, false)
  assert.equal(f.writes.length, 2)
  f.dispose()
  assert.equal(f.handlers.size, 0)
})

test('未打包、开发地址和不支持的平台在查询及修改前阻断全部系统接口', () => {
  for (const input of [{ packaged: false }, { development: true }, { platform: 'linux' as const }]) {
    const f = fixture(input)
    const value = f.get()
    assert.equal(value.ok && value.value.available, false)
    assert.equal(value.ok && value.value.enabled, false)
    assert.deepEqual(f.set(true), { ok: false, error: 'unavailable' })
    assert.deepEqual(f.set(false), { ok: false, error: 'unavailable' })
    assert.deepEqual(f.reads, [])
    assert.deepEqual(f.writes, [])
  }
})

test('拒绝不可信窗口和非布尔参数，不接受调用方传入执行路径', () => {
  const f = fixture()
  f.setTrusted(false)
  assert.throws(f.get, /LOGIN_ITEM_IPC_NOT_ALLOWED/)
  assert.throws(() => f.set(true), /LOGIN_ITEM_IPC_NOT_ALLOWED/)
  f.setTrusted(true)
  for (const value of [undefined, null, 1, 'true', [], { enabled: true, path: 'other.exe' }]) {
    assert.deepEqual(f.set(value), { ok: false, error: 'invalid_request' })
  }
  assert.deepEqual(f.reads, [])
  assert.deepEqual(f.writes, [])
})

test('Windows 只识别本应用当前用户启动项，并考虑系统禁用状态', () => {
  const f = fixture()
  f.set(true)
  const entry = { ...f.state.launchItems[0] }
  const patches: Partial<LaunchItems>[] = [{ enabled: false }, { name: 'other' }, { scope: 'machine' }, { args: ['--other'] }, { path: 'C:\\Other.exe' }]
  for (const patch of patches) {
    f.state.launchItems = [{ ...entry, ...patch }]
    const result = f.get()
    assert.equal(result.ok && result.value.enabled, false)
  }
  f.state.launchItems = [{ ...entry, path: entry.path.toUpperCase() }]
  const result = f.get()
  assert.equal(result.ok && result.value.enabled, true)
})

test('Windows 含空格、中文及网络安装路径可以回读，写入保留原始路径', () => {
  for (const executablePath of ['C:\\Termous\\Termous.exe', 'C:\\Program Files\\Termous\\Termous.exe', 'D:\\应用 软件\\Termous.exe', '\\\\server\\shared apps\\Termous.exe']) {
    const f = fixture({ executablePath })
    const result = f.set(true)
    assert.equal(result.ok && result.value.enabled, true, executablePath)
    assert.deepEqual(f.writes[0], { openAtLogin: true, enabled: true, path: executablePath, args: [], name: 'dev.termous.app' })
    assert.deepEqual(f.reads[0], { path: `"${executablePath}"`, args: [] })
    const disabled = f.set(false)
    assert.equal(disabled.ok && disabled.value.enabled, false)
  }
})

test('系统已禁用的启动项移除失败时不能误报关闭成功', () => {
  const f = fixture()
  f.set(true)
  f.state.launchItems[0].enabled = false
  const state = f.get()
  assert.equal(state.ok && state.value.enabled, false)
  f.rejectChange()
  assert.deepEqual(f.set(false), { ok: false, error: 'not_applied' })
  assert.equal(f.writes.length, 2)
  assert.equal(f.state.openAtLogin, true)
})

test('读取、修改和系统拒绝的错误明确返回，失败不自动重放', () => {
  const read = fixture()
  read.setReadError()
  assert.deepEqual(read.get(), { ok: false, error: 'read_failed' })
  const write = fixture()
  write.setWriteError()
  assert.deepEqual(write.set(true), { ok: false, error: 'write_failed' })
  assert.equal(write.writes.length, 1)
  const denied = fixture()
  denied.rejectChange()
  assert.deepEqual(denied.set(true), { ok: false, error: 'not_applied' })
  assert.equal(denied.writes.length, 1)
  const uncertain = fixture()
  uncertain.setReadError()
  assert.deepEqual(uncertain.set(true), { ok: false, error: 'read_failed' })
  assert.equal(uncertain.writes.length, 1)
})

test('macOS 待系统批准单独展示，且不传递 Windows 注册参数', () => {
  const f = fixture({ platform: 'darwin' })
  f.rejectChange()
  f.state.status = 'requires-approval'
  assert.deepEqual(f.set(true), { ok: true, value: { available: true, enabled: true, unavailable_reason: null, requires_approval: true } })
  assert.deepEqual(f.writes, [{ openAtLogin: true }])
  assert.deepEqual(f.reads, [undefined])
})
