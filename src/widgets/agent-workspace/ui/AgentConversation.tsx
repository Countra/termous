import { BrainCircuit, CircleAlert, FileCode2, Image, LoaderCircle, MessageSquareText, Waypoints } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspaceMessage, AgentWorkspaceRunStatus } from '../model/types.ts'
import type { AgentAttachment } from '#entities/agent'
import { AgentMarkdown } from './AgentMarkdown.tsx'
import { AgentToolTimeline } from './AgentToolTimeline.tsx'
import styles from './AgentConversation.module.scss'

export function AgentConversation({
  messages,
  runStatus,
  loading,
  sessionKey,
  onPreviewAttachment = () => undefined,
}: {
  messages: AgentWorkspaceMessage[]
  runStatus: AgentWorkspaceRunStatus
  loading: boolean
  sessionKey: string
  onPreviewAttachment?: (attachment: AgentAttachment) => void
}) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const followTailRef = useRef(true)
  const previousSessionKeyRef = useRef(sessionKey)
  const latestSignature = messageContentSignature(messages)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (previousSessionKeyRef.current !== sessionKey) {
      previousSessionKeyRef.current = sessionKey
      followTailRef.current = true
    }
    if (!followTailRef.current) return
    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ top: viewport.scrollHeight })
    else viewport.scrollTop = viewport.scrollHeight
  }, [latestSignature, runStatus, sessionKey])

  if (!loading && messages.length === 0) {
    return (
      <div className={styles['conversation-empty']}>
        <span><MessageSquareText size={22} aria-hidden="true" /></span>
        <h2>{t('agent.empty.title')}</h2>
        <p>{t('agent.empty.description')}</p>
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      className={styles.conversation}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-busy={runStatus === 'queued' || runStatus === 'starting' || runStatus === 'running'}
      onScroll={(event) => {
        const viewport = event.currentTarget
        followTailRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
      }}
    >
      <div className={styles['message-stack']}>
        {messages.map((message) => (
          <article key={message.id} className={`${styles.message} ${styles[`is-${message.role}`]}`}>
            <header>
              <span>{t(message.role === 'user' ? 'agent.message.you' : 'agent.message.agent')}</span>
              <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
            </header>
            <div className={styles['message-content']}>
              {message.source_context ? (
                <div className={styles['message-source']}><Waypoints size={12} />{message.source_context.title}</div>
              ) : null}
              {message.parts.map((part) => {
                if (part.kind === 'text') return <AgentMarkdown key={part.id}>{part.text}</AgentMarkdown>
                if (part.kind === 'tool') return <AgentToolTimeline key={part.id} tool={part} />
                if (!part.text.trim()) return null
                return (
                  <details key={part.id} className={styles.reasoning} open={part.streaming || undefined}>
                    <summary><BrainCircuit size={14} />{t(part.streaming ? 'agent.reasoning.running' : 'agent.reasoning.completed')}</summary>
                    <div>{part.text}</div>
                  </details>
                )
              })}
              {message.attachments.length > 0 ? (
                <div className={styles['message-attachments']}>
                  {message.attachments.map((attachment) => (
                    <button key={attachment.id} type="button" onClick={() => onPreviewAttachment(attachment)}>
                      {attachment.kind === 'image' ? <Image size={13} /> : <FileCode2 size={13} />}
                      <span>{attachment.original_name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {message.status === 'streaming' && message.parts.length === 0 ? (
                <span className={styles['streaming-state']}><LoaderCircle size={14} />{t('agent.status.running')}</span>
              ) : null}
              {message.status === 'failed' || message.status === 'interrupted' ? (
                <span className={styles['message-failure']}><CircleAlert size={14} />{t(`agent.message.${message.status}`)}</span>
              ) : null}
            </div>
          </article>
        ))}
        {runStatus === 'starting' || runStatus === 'queued' ? (
          <div className={styles['run-pending']}><LoaderCircle size={14} />{t(`agent.status.${runStatus}`)}</div>
        ) : null}
      </div>
    </div>
  )
}

function messageContentSignature(messages: AgentWorkspaceMessage[]) {
  return messages.map((message) => {
    const parts = message.parts.map((part) => {
      if (part.kind === 'tool') {
        return `${part.id}:${part.status}:${part.duration_ms ?? ''}:${part.summary?.length ?? 0}:${part.detail?.length ?? 0}`
      }
      return `${part.id}:${part.kind}:${part.text.length}:${part.kind === 'reasoning' && part.streaming ? 1 : 0}`
    }).join(',')
    return `${message.id}:${message.status}:${parts}`
  }).join('|')
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}
