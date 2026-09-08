import { Check, Clock3, Copy } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeClipboardText } from '#shared/clipboard'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { formatAgentMessageDuration, formatAgentMessageTime } from './agentMessageTimeFormat.ts'
import styles from './AgentMessageActions.module.scss'

export const AgentMessageActions = memo(function AgentMessageActions({ message }: { message: AgentWorkspaceMessage }) {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const operation = useRef(0)
  const pending = useRef(false)
  const feedbackTimer = useRef<number | undefined>(undefined)
  const markdown = message.status === 'streaming' ? '' : message.parts
    .flatMap((part) => part.kind === 'text' ? [part.text] : []).join('\n\n')
  const time = useMemo(() => formatAgentMessageTime(message.created_at, i18n.resolvedLanguage), [message.created_at, i18n.resolvedLanguage])
  const duration = message.role === 'assistant' && message.status !== 'streaming'
    ? formatAgentMessageDuration(message.duration_ms, i18n.resolvedLanguage)
    : undefined
  const canCopy = Boolean(markdown.trim())

  useEffect(() => {
    setStatus('idle')
    return () => {
      // 正文变化或切换会话后，不让旧剪贴板回执标记新的内容。
      operation.current += 1
      pending.current = false
      window.clearTimeout(feedbackTimer.current)
    }
  }, [message.id, markdown])

  if (message.role === 'assistant' && message.status === 'streaming') return null
  if (!canCopy && !time && duration === undefined) return null
  const copy = async () => {
    if (pending.current || !canCopy) return
    pending.current = true
    const current = ++operation.current
    window.clearTimeout(feedbackTimer.current)
    setStatus('copying')
    try {
      await writeClipboardText(markdown)
      if (operation.current !== current) return
      setStatus('copied')
      feedbackTimer.current = window.setTimeout(() => setStatus('idle'), 1800)
    } catch {
      if (operation.current === current) setStatus('failed')
    } finally {
      if (operation.current === current) pending.current = false
    }
  }
  return (
    <div className={styles.actions}>
      {canCopy ? <Tooltip title={t(status === 'copied' ? 'agent.message.copied' : 'app.copy')}>
        <Button
          type="text"
          size="small"
          className={styles.copy}
          data-copied={status === 'copied' || undefined}
          aria-label={t('app.copy')}
          aria-busy={status === 'copying'}
          loading={status === 'copying'}
          icon={status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          onClick={() => void copy()}
        />
      </Tooltip> : null}
      {time ? (
        <Tooltip title={time.full} trigger={['hover', 'focus']}>
          <time className={styles.time} dateTime={message.created_at} tabIndex={0} aria-label={time.full}>{time.short}</time>
        </Tooltip>
      ) : null}
      {duration !== undefined ? (
        <Tooltip title={t('agent.message.durationHint')} trigger={['hover', 'focus']}>
          <span className={styles.duration} tabIndex={0}>
            <Clock3 size={14} aria-hidden="true" />{t('agent.message.duration', { duration })}
          </span>
        </Tooltip>
      ) : null}
      <span className={styles.announcement} role="status">{status === 'copied' ? t('agent.message.copied') : ''}</span>
      {status === 'failed' ? <span className={styles.error} role="alert">{t('agent.message.copyFailed')}</span> : null}
    </div>
  )
})
