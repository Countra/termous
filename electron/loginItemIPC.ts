import type { App, IpcMain, IpcMainInvokeEvent } from 'electron'
import { loginItemIPCChannels, type LoginItemResponse, type LoginItemState } from '#common/contracts'

interface LoginItemOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  app: Pick<App, 'isPackaged' | 'getLoginItemSettings' | 'setLoginItemSettings'>
  platform: NodeJS.Platform
  development: boolean
  executablePath: string
  entryName: string
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

// 只注册入口，不在应用启动、读取设置或恢复备份时写入系统启动项。
export function registerLoginItemIPC(options: LoginItemOptions) {
  const unavailableReason = (): LoginItemState['unavailable_reason'] => {
    if (!options.app.isPackaged || options.development) return 'development'
    if (options.platform !== 'win32' && options.platform !== 'darwin') return 'unsupported_platform'
    return null
  }
  const assertTrusted = (event: IpcMainInvokeEvent) => {
    if (!options.isTrustedSender(event)) throw new Error('LOGIN_ITEM_IPC_NOT_ALLOWED')
  }
  const read = (requestedEnabled?: boolean): LoginItemResponse => {
    const reason = unavailableReason()
    if (reason) return { ok: true, value: { available: false, enabled: false, unavailable_reason: reason, requires_approval: false } }
    try {
      // Electron 43 将查询路径作为命令行解析；加引号避免空格截断，写入仍传原始路径。
      const settings = options.app.getLoginItemSettings(options.platform === 'win32'
        ? { path: `"${options.executablePath}"`, args: [] }
        : undefined)
      const requiresApproval = options.platform === 'darwin' && settings.status === 'requires-approval'
      // Windows 只展示本应用管理的当前用户启动项，避免其他参数或系统级启动项掩盖禁用状态。
      const enabled = options.platform === 'win32'
        ? settings.openAtLogin && settings.launchItems.some((item) => (
            item.name === options.entryName && item.scope === 'user' && item.enabled
            && item.path.toLowerCase() === options.executablePath.toLowerCase()
            && item.args.length === 0
          ))
        : settings.openAtLogin || requiresApproval
      // 系统禁用不等于移除注册；关闭操作必须确认本应用启动项确实已被移除。
      if (requestedEnabled !== undefined && (enabled !== requestedEnabled || (!requestedEnabled && settings.openAtLogin))) {
        return { ok: false, error: 'not_applied' }
      }
      return { ok: true, value: { available: true, enabled, unavailable_reason: null, requires_approval: requiresApproval } }
    } catch {
      return { ok: false, error: 'read_failed' }
    }
  }

  options.ipcMain.handle(loginItemIPCChannels.get, (event): LoginItemResponse => {
    assertTrusted(event)
    return read()
  })
  options.ipcMain.handle(loginItemIPCChannels.setEnabled, (event, enabled: unknown): LoginItemResponse => {
    assertTrusted(event)
    // 主进程独立校验环境，绕过禁用的界面也不能在开发模式调用系统接口。
    if (unavailableReason()) return { ok: false, error: 'unavailable' }
    if (typeof enabled !== 'boolean') return { ok: false, error: 'invalid_request' }
    try {
      options.app.setLoginItemSettings(options.platform === 'win32'
        ? { openAtLogin: enabled, enabled, path: options.executablePath, args: [], name: options.entryName }
        : { openAtLogin: enabled })
    } catch {
      return { ok: false, error: 'write_failed' }
    }
    // 系统可能拒绝修改；回读后才报告成功，不能只依据无异常返回。
    return read(enabled)
  })
  return () => {
    options.ipcMain.removeHandler(loginItemIPCChannels.get)
    options.ipcMain.removeHandler(loginItemIPCChannels.setEnabled)
  }
}
