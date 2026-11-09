import { app, type BrowserWindow } from 'electron'

export function indicatorSupported() {
  return process.platform !== 'linux' || (process.env.XDG_SESSION_TYPE !== 'wayland' && !process.env.WAYLAND_DISPLAY && app.commandLine.getSwitchValue('ozone-platform') !== 'wayland')
}
export function configureIndicatorWindow(window: BrowserWindow, badge: boolean, warn: (code: string) => void) {
  window.setAlwaysOnTop(true, 'screen-saver')
  if (badge) window.setIgnoreMouseEvents(true, { forward: true })
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { window.setContentProtection(true) }
    catch { warn('desktop_indicator_content_protection_unavailable') }
  }
}
