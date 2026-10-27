import { dialog, Notification } from 'electron'
import { nativeNotificationOptions } from '../notifications/nativeOptions.ts'

export function reportDesktopReclaimFailure(language: string, icon: string, warn: (code: string) => void) {
  const zh = language.startsWith('zh')
  const title = zh ? '桌面收回需要关注' : 'Desktop reclaim needs attention'
  const body = zh ? '收回结果未确认，请检查桌面状态后重试。已经撤销的控制不会恢复。' : 'Reclaim could not be confirmed. Check the desktop state and try again. Revoked control will not be restored.'
  const fallback = () => { void dialog.showMessageBox({ type: 'warning', title, message: body }).catch(() => warn('desktop_reclaim_feedback_failed')) }
  if (!Notification.isSupported()) { fallback(); return }
  try {
    const notification = new Notification(nativeNotificationOptions(title, body, 'desktop-reclaim', icon, process.platform))
    notification.once('failed', fallback)
    notification.show()
  } catch { fallback() }
}
