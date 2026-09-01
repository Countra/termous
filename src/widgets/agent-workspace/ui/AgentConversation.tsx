import { ArrowDown, Bot, BrainCircuit, ChevronRight, CircleAlert, FileCode2, Image, LoaderCircle, Waypoints } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { memo, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspaceMessage, AgentWorkspaceRunStatus } from '../model/types.ts'
import type { AgentAttachment } from '#entities/agent'
import { AgentAttachmentThumbnail } from './AgentAttachmentThumbnail.tsx'
import { AgentMarkdown } from './AgentMarkdown.tsx'
import { AgentTurnUsage } from './AgentTurnUsage.tsx'
import { AgentToolTimeline } from './AgentToolTimeline.tsx'
import styles from './AgentConversation.module.scss'

interface AgentConversationProps {
  messages: AgentWorkspaceMessage[]
  runStatus: AgentWorkspaceRunStatus
  loading: boolean
  sessionKey: string
  showTurnTokenUsage?: boolean
  onPreviewAttachment?: (attachment: AgentAttachment) => void
  onLoadAttachmentContent?: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
}

const ignoreAttachmentPreview = () => undefined

export const AgentConversation = memo(function AgentConversation(props: AgentConversationProps) {
  return <AgentConversationSession key={props.sessionKey} {...props} />
})

function AgentConversationSession({
  messages,
  runStatus,
  loading,
  sessionKey,
  showTurnTokenUsage = true,
  onPreviewAttachment = ignoreAttachmentPreview,
  onLoadAttachmentContent,
}: AgentConversationProps) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const followTailRef = useRef(true)
  const followTailFrameRef = useRef<number | undefined>(undefined)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const deferredMessages = useDeferredValue(messages)
  const latestSignature = latestMessageContentSignature(deferredMessages)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !followTailRef.current) return
    const frame = window.requestAnimationFrame(() => {
      if (followTailFrameRef.current === frame) followTailFrameRef.current = undefined
      if (!followTailRef.current) return
      if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ top: viewport.scrollHeight })
      else viewport.scrollTop = viewport.scrollHeight
      setShowJumpToLatest(false)
    })
    followTailFrameRef.current = frame
    return () => {
      if (followTailFrameRef.current !== frame) return
      window.cancelAnimationFrame(frame)
      followTailFrameRef.current = undefined
    }
  }, [latestSignature, runStatus, sessionKey, showTurnTokenUsage])

  const empty = !loading && deferredMessages.length === 0

  return (
    <div className={styles['conversation-shell']}>
      <div
        ref={viewportRef}
        className={styles.conversation}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={runStatus === 'queued' || runStatus === 'starting' || runStatus === 'running'}
        onScroll={(event) => {
          const viewport = event.currentTarget
          const following = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
          followTailRef.current = following
          setShowJumpToLatest(!following)
        }}
      >
        {empty ? (
          <div className={styles['conversation-empty']}>
            <span><Bot size={21} aria-hidden="true" /></span>
            <h2>{t('agent.empty.title')}</h2>
          </div>
        ) : (
          <AgentMessageStack
            messages={deferredMessages}
            runStatus={runStatus}
            showTurnTokenUsage={showTurnTokenUsage}
            onPreviewAttachment={onPreviewAttachment}
            onLoadAttachmentContent={onLoadAttachmentContent}
          />
        )}
      </div>
      {showJumpToLatest && !empty ? (
        <Tooltip title={t('agent.conversation.jumpToLatest')}>
          <Button
            type="text"
            className={styles['jump-to-latest']}
            aria-label={t('agent.conversation.jumpToLatest')}
            icon={<ArrowDown size={16} />}
            onClick={() => {
              const viewport = viewportRef.current
              if (!viewport) return
              followTailRef.current = true
              setShowJumpToLatest(false)
              viewport.scrollTo({ top: viewport.scrollHeight })
            }}
          />
        </Tooltip>
      ) : null}
    </div>
  )
}

const AgentMessageStack = memo(function AgentMessageStack({
  messages,
  runStatus,
  showTurnTokenUsage,
  onPreviewAttachment,
  onLoadAttachmentContent,
}: {
  messages: AgentWorkspaceMessage[]
  runStatus: AgentWorkspaceRunStatus
  showTurnTokenUsage: boolean
  onPreviewAttachment: (attachment: AgentAttachment) => void
  onLoadAttachmentContent?: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
}) {
  const { t } = useTranslation()
  return (
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
            {onLoadAttachmentContent && message.attachments.some(({ kind }) => kind === 'image') ? (
              <div className={styles['message-images']}>
                {message.attachments.filter(({ kind }) => kind === 'image').map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className={styles['message-image']}
                    aria-label={t('agent.attachments.previewName', { name: attachment.original_name })}
                    title={attachment.original_name}
                    onClick={() => onPreviewAttachment(attachment)}
                  >
                    <AgentAttachmentThumbnail
                      className={styles['message-image-media']}
                      source={{ kind: 'remote', attachment, load: onLoadAttachmentContent }}
                      alt={attachment.original_name}
                    />
                  </button>
                ))}
              </div>
            ) : null}
            {message.parts.map((part) => {
              if (part.kind === 'text') return <AgentMarkdown key={part.id}>{part.text}</AgentMarkdown>
              if (part.kind === 'tool') return <AgentToolTimeline key={part.id} tool={part} />
              if (!part.text.trim()) return null
              return (
                <details key={part.id} className={styles.reasoning} open={part.streaming || undefined}>
                  <summary>
                    <ChevronRight className={styles['reasoning-chevron']} size={13} aria-hidden="true" />
                    <BrainCircuit size={14} aria-hidden="true" />
                    {t(part.streaming ? 'agent.reasoning.running' : 'agent.reasoning.completed')}
                  </summary>
                  <div>{part.text}</div>
                </details>
              )
            })}
            {message.attachments.some((attachment) => attachment.kind !== 'image' || !onLoadAttachmentContent) ? (
              <div className={styles['message-attachments']}>
                {message.attachments.filter((attachment) => attachment.kind !== 'image' || !onLoadAttachmentContent).map((attachment) => (
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
            {message.status === 'failed' || message.status === 'interrupted' || message.status === 'interrupted_by_steer' ? (
              <span className={styles['message-failure']} data-status={message.status}><CircleAlert size={14} />{t(`agent.message.${message.status}`)}</span>
            ) : null}
          </div>
          {showTurnTokenUsage
            && message.role === 'assistant'
            && message.status !== 'streaming'
            && message.usage
            && message.usage.total_tokens > 0 ? (
            <AgentTurnUsage usage={message.usage} />
          ) : null}
        </article>
      ))}
      {runStatus === 'starting' || runStatus === 'queued' ? (
        <div className={styles['run-pending']}><LoaderCircle size={14} />{t(`agent.status.${runStatus}`)}</div>
      ) : null}
    </div>
  )
})

function latestMessageContentSignature(messages: AgentWorkspaceMessage[]) {
  const message = messages[messages.length - 1]
  if (!message) return 'empty'
  const parts = message.parts.map((part) => {
    if (part.kind === 'tool') {
      return `${part.id}:${part.status}:${part.duration_ms ?? ''}:${part.summary?.length ?? 0}:${part.detail?.length ?? 0}`
    }
    return `${part.id}:${part.kind}:${part.text.length}:${part.kind === 'reasoning' && part.streaming ? 1 : 0}`
  }).join(',')
  const usage = message.usage
    ? `${message.usage.input_tokens}:${message.usage.cache_read_tokens}:${message.usage.cache_write_tokens}:${message.usage.output_tokens}:${message.usage.total_tokens}:${message.usage.estimated ? 1 : 0}`
    : ''
  const attachments = message.attachments
    .map((attachment) => `${attachment.id}:${attachment.kind}:${attachment.revision}:${attachment.size_bytes}`)
    .join(',')
  return `${messages.length}:${message.id}:${message.status}:${parts}:${attachments}:${usage}`
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}
