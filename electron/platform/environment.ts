import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { App } from 'electron'
import { assertDesktopChannel, desktopIdentity, type DesktopChannel } from '#common/desktop-identity'

declare const __TERMOUS_DESKTOP_CHANNEL__: DesktopChannel
export const desktopChannel = __TERMOUS_DESKTOP_CHANNEL__
export const identity = desktopIdentity(desktopChannel)

export function initializeDesktopEnvironment(app: App) {
  const metadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { termousDesktopChannel?: unknown }
  assertDesktopChannel(desktopChannel, metadata.termousDesktopChannel)
  // 正式版保留 Electron 既有目录，不能随 AppId 变更搬动偏好与浏览器状态。
  const userData = desktopChannel === 'development'
    ? path.join(app.getPath('appData'), identity.name)
    : app.getPath('userData')
  mkdirSync(userData, { recursive: true })
  const logs = desktopChannel === 'development' ? path.join(userData, 'logs') : app.getPath('logs')
  app.setName(identity.name)
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
  app.setAppLogsPath(logs)
  if (process.platform === 'win32') {
    app.setAppUserModelId(identity.appId)
    app.setToastActivatorCLSID(identity.toastClsid)
  }
  if (process.platform === 'linux') app.setDesktopName(identity.desktopName)
}

export function registerDevelopmentLease(app: App, report: (event: string, fields: Record<string, unknown>) => void) {
  if (desktopChannel !== 'development') return
  const metadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { termousDevelopmentCache: string }
  const file = path.join(metadata.termousDevelopmentCache, 'active.json')
  writeFileSync(file, JSON.stringify({ pid: process.pid }))
  app.once('will-quit', () => {
    try { if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) unlinkSync(file) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report('development-lease-cleanup-failed', { code: (error as NodeJS.ErrnoException).code }) }
  })
}
