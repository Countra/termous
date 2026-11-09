import { pathToFileURL } from 'node:url'
import type { NotificationConstructorOptions } from 'electron'

const xml = (text: string) => text.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!)

export function nativeNotificationOptions(title: string, body: string, id: string, icon: string, platform: NodeJS.Platform): NotificationConstructorOptions {
  const options: NotificationConstructorOptions = { id, title, body, icon }
  // Electron 43 的默认正文未设置 launch 参数，显式携带 ID 才能统一冷、热激活。
  if (platform === 'win32') options.toastXml = `<toast launch="type=click&amp;tag=${xml(id)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text><image placement="appLogoOverride" src="${xml(pathToFileURL(icon).href)}"/></binding></visual></toast>`
  return options
}
