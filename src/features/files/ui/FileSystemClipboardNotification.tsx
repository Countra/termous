import { useEffect, useState } from 'react'
import { App, Button, Progress } from 'antd'
import { ClipboardCopy, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '#shared/format'
import { termousNotificationClassName } from '#shared/ui'
import { useFileSystemClipboard } from '../model/useFileSystemClipboard'
import styles from './FileSystemClipboardNotification.module.scss'

const notificationKey = 'files-system-clipboard'

// 窗口只挂载一个通知入口；切换文件页面或收起侧栏不会撤下仍有效的剪贴板提示。
export function FileSystemClipboardNotification() {
  const { notification } = App.useApp()
  const { t } = useTranslation()
  const { state, cancelling, revoke } = useFileSystemClipboard()
  const [hiddenKey, setHiddenKey] = useState('')
  const inactive = state.phase === 'stopped' || state.phase === 'closed'
  const running = !inactive && (state.task?.status === 'running' || state.task?.status === 'queued')
  const error = state.error_code ?? (!inactive && state.task?.status === 'failed' ? state.task.error_code : undefined)
  const key = `${state.operation_id ?? state.publication_id ?? ''}:${state.phase}:${error ?? ''}`
  const expiry = state.phase === 'stopped' ? 2000 : state.phase === 'replaced' && !running ? 4000 : 0

  useEffect(() => {
    if (!expiry) return
    // 使用终态标识计时，进度轮询或普通重绘不会重新开始倒计时。
    const timer = window.setTimeout(() => setHiddenKey(key), expiry)
    return () => window.clearTimeout(timer)
  }, [expiry, key])

  useEffect(() => () => notification.destroy(notificationKey), [notification])

  useEffect(() => {
    if (state.phase === 'idle' || state.phase === 'closed' || state.phase === 'unavailable' || key === hiddenKey) {
      notification.destroy(notificationKey)
      return
    }
    const cancelAvailable = !!state.publication_id && (state.phase === 'preparing' || state.phase === 'ready' || state.phase === 'cleanup_pending' || state.phase === 'failed' && state.published || running)
    const stage = cancelling ? 'cancelling' : running ? 'receiving' : state.phase
    const title = state.phase === 'cleanup_pending' && !cancelling
      ? t('files.systemClipboard.cleanup_pending')
      : error && !cancelling
        ? t('files.systemClipboard.failed')
        : t(`files.systemClipboard.${stage}`, { count: state.count })
    const hint = error && !cancelling
      ? t(`files.systemClipboard.errors.${error}`, { defaultValue: t('files.systemClipboard.retryHint') })
      : t(`files.systemClipboard.${stage}Hint`, { defaultValue: t('files.systemClipboard.retryHint') })
    const filename = running && state.task?.current_file ? state.task.current_file : state.names.join('、')
    const percent = Math.max(0, Math.min(100, Math.floor(state.task?.progress_percent || 0)))

    notification.open({
      key: notificationKey,
      placement: 'topRight',
      className: termousNotificationClassName,
      title,
      icon: cancelling || state.phase === 'preparing'
        ? <LoaderCircle size={20} className={styles['pending-icon']} />
        : <ClipboardCopy size={20} className={styles.icon} />,
      role: error && !cancelling ? 'alert' : 'status',
      duration: 0,
      showProgress: false,
      closable: !cancelAvailable && !cancelling && state.phase !== 'stopped' ? { 'aria-label': t('app.close') } : false,
      onClose: () => setHiddenKey(key),
      description: <div className={styles.content}>
        {!cancelling && !inactive && filename && (
          <div className={styles.selection}>
            <span className={styles.names} title={filename}>{filename}</span>
            {running && state.count > 1 && <span className={styles.count}>{t('files.systemClipboard.itemCount', { count: state.count })}</span>}
          </div>
        )}
        {running && !cancelling && state.task && <div className={styles.transfer}>
          <Progress percent={percent} size="small" showInfo={false} aria-label={t('files.systemClipboard.receiving')} />
          <div className={styles.metrics}>
            <span>{formatBytes(state.task.transferred_bytes)} / {formatBytes(state.task.total_bytes)}</span>
            <span>{percent}%</span>
          </div>
        </div>}
        {(!running || error || cancelling) && <p className={styles.hint}>{hint}</p>}
      </div>,
      actions: cancelAvailable || cancelling ? <Button size="small" loading={cancelling} disabled={cancelling} onClick={() => void revoke(state.publication_id)}>
        {t(state.phase === 'cleanup_pending' ? 'files.systemClipboard.retryCancel' : 'files.systemClipboard.cancel')}
      </Button> : undefined,
    })
  }, [notification, state, cancelling, revoke, t, running, inactive, error, key, hiddenKey])

  return null
}
