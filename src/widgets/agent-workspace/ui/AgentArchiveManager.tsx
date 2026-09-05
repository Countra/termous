import { Alert, Button, Dropdown, Input, Modal, Spin } from 'antd'
import { Archive, ArrowLeft, ArchiveRestore, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAttachment, AgentSession } from '#entities/agent'
import { contextActionMenuPopupClassName } from '#shared/ui'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { AgentAttachmentPreview } from './AgentAttachmentPreview.tsx'
import { AgentConversation } from './AgentConversation.tsx'
import styles from './AgentArchiveManager.module.scss'

export interface AgentArchiveManagerProps {
  open: boolean
  sessions: AgentSession[]
  query: string
  listLoading: boolean
  listError?: string
  selectedSession?: AgentSession
  messages: AgentWorkspaceMessage[]
  previewLoading: boolean
  previewError?: string
  pendingIds?: ReadonlySet<string>
  showTurnTokenUsage?: boolean
  onClose: () => void
  onQueryChange: (query: string) => void
  onSelect: (sessionId?: string) => void
  onReload: () => void
  onReloadPreview: () => void
  onRestore: (session: AgentSession) => Promise<boolean | void>
  onDelete: (session: AgentSession) => Promise<boolean | void>
  onLoadAttachmentContent: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
}

export function AgentArchiveManager(props: AgentArchiveManagerProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open={props.open}
      centered
      width="min(1120px, calc(100vw - 32px))"
      title={<span className={styles.title}><Archive size={16} aria-hidden="true" />{t('agent.archives.title')}</span>}
      footer={null}
      destroyOnHidden
      className={`termous-modal ${styles.modal}`}
      onCancel={props.onClose}
    >
      {props.open ? <ArchiveContents {...props} /> : null}
    </Modal>
  )
}

function ArchiveContents({
  sessions, query, listLoading, listError, selectedSession, messages,
  previewLoading, previewError, pendingIds, showTurnTokenUsage, onQueryChange, onSelect,
  onReload, onReloadPreview, onRestore, onDelete, onLoadAttachmentContent,
}: AgentArchiveManagerProps) {
  const { t, i18n } = useTranslation()
  const [previewAttachment, setPreviewAttachment] = useState<AgentAttachment>()
  const [deleteSession, setDeleteSession] = useState<AgentSession>()
  const [pendingSessionIds, setPendingSessionIds] = useState<ReadonlySet<string>>(new Set())
  const [failedSessionIds, setFailedSessionIds] = useState<ReadonlySet<string>>(new Set())
  const operationsInFlight = useRef(new Set<string>())
  const mounted = useRef(true)
  const backButton = useRef<HTMLButtonElement>(null)
  const listButton = useRef<HTMLButtonElement>(null)
  const previousSelected = useRef<string | undefined>(undefined)
  const selectedSessionId = selectedSession?.id
  const busy = selectedSessionId ? pendingSessionIds.has(selectedSessionId) || pendingIds?.has(selectedSessionId) : false
  const deleteBusy = deleteSession ? pendingSessionIds.has(deleteSession.id) || pendingIds?.has(deleteSession.id) : false
  const deleteTarget = deleteSession && [selectedSession, ...sessions].reduce<AgentSession>((current, value) => (
    value?.id === current.id && value.revision > current.revision ? value : current
  ), deleteSession)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    setPreviewAttachment(undefined)
    if (selectedSessionId) backButton.current?.focus()
    else if (previousSelected.current) listButton.current?.focus()
    previousSelected.current = selectedSessionId
  }, [selectedSessionId])

  const perform = async (session: AgentSession, operation: AgentArchiveManagerProps['onDelete']) => {
    if (operationsInFlight.current.has(session.id) || pendingIds?.has(session.id)) return false
    operationsInFlight.current.add(session.id)
    setPendingSessionIds(new Set(operationsInFlight.current))
    setFailedSessionIds((current) => new Set([...current].filter((id) => id !== session.id)))
    try {
      return await operation(session) !== false
    } catch {
      if (mounted.current) setFailedSessionIds((current) => new Set([...current, session.id]))
      return false
    } finally {
      operationsInFlight.current.delete(session.id)
      if (mounted.current) setPendingSessionIds(new Set(operationsInFlight.current))
    }
  }

  return (
    <div className={styles.manager}>
      <div className={`${styles.layout} ${selectedSession ? styles['has-preview'] : ''}`}>
        <section className={styles.sidebar} aria-label={t('agent.archives.title')}>
          <div className={styles.search}>
            <Input
              allowClear
              prefix={<Search size={14} aria-hidden="true" />}
              value={query}
              placeholder={t('agent.archives.search')}
              aria-label={t('agent.archives.search')}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </div>
          {listError ? (
            <ArchiveError label={t('agent.archives.listFailed')} onRetry={onReload} />
          ) : null}
          <div className={styles.list} role="list" aria-busy={listLoading}>
            {listLoading ? <ArchiveLoading label={t('agent.archives.loading')} /> : null}
            {!listLoading && !listError && sessions.length === 0 ? (
              <p className={styles.placeholder}>{t(query.trim() ? 'agent.archives.noResults' : 'agent.archives.empty')}</p>
            ) : null}
            {sessions.map((session, index) => (
              <div role="listitem" key={session.id}>
                <button
                  ref={index === 0 ? listButton : undefined}
                  type="button"
                  className={styles.row}
                  aria-current={session.id === selectedSession?.id ? 'true' : undefined}
                  onClick={() => onSelect(session.id)}
                >
                  <Archive size={14} aria-hidden="true" />
                  <span>
                    <strong>{session.title}</strong>
                    <time dateTime={session.archived_at}>{formatArchiveDate(session.archived_at, i18n.resolvedLanguage)}</time>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.preview} aria-label={selectedSession?.title ?? t('agent.archives.select')}>
          {selectedSession ? (
            <>
              <div className={styles['preview-header']}>
                <Button ref={backButton} className={styles.back} type="text" icon={<ArrowLeft size={15} />} aria-label={t('agent.archives.back')} onClick={() => onSelect()} />
                <strong className={styles['preview-title']}>{selectedSession.title}</strong>
                <div className={styles['preview-actions']}>
                  <Button size="small" icon={<ArchiveRestore size={14} />} loading={busy} onClick={() => void perform(selectedSession, onRestore)}>{t('agent.archives.restore')}</Button>
                  <Dropdown
                    trigger={['click']}
                    disabled={busy}
                    classNames={{ root: contextActionMenuPopupClassName }}
                    menu={{ items: [{ key: 'delete', danger: true, icon: <Trash2 size={14} />, label: t('app.delete') }], onClick: () => setDeleteSession(selectedSession) }}
                  >
                    <Button type="text" size="small" icon={<MoreHorizontal size={15} />} disabled={busy} aria-label={t('agent.sessions.more')} />
                  </Dropdown>
                </div>
              </div>
              <p className={styles.notice}>{t('agent.archives.readonly')}</p>
              {failedSessionIds.has(selectedSession.id) ? <Alert type="error" showIcon title={t('agent.archives.operationFailed')} /> : null}
              {previewError ? <ArchiveError label={t('agent.archives.previewFailed')} onRetry={onReloadPreview} /> : previewLoading ? (
                <ArchiveLoading label={t('agent.archives.loadingPreview')} />
              ) : (
                <AgentConversation
                  sessionKey={`archive:${selectedSession.id}`}
                  messages={messages}
                  loading={false}
                  runStatus="idle"
                  showTurnTokenUsage={showTurnTokenUsage}
                  onPreviewAttachment={setPreviewAttachment}
                  onLoadAttachmentContent={onLoadAttachmentContent}
                />
              )}
            </>
          ) : <p className={styles.placeholder}><Archive size={24} aria-hidden="true" />{t('agent.archives.select')}</p>}
        </section>
      </div>
      <AgentAttachmentPreview attachment={previewAttachment} onClose={() => setPreviewAttachment(undefined)} onLoad={onLoadAttachmentContent} />
      <Modal
        open={Boolean(deleteSession)}
        centered
        className="termous-modal"
        title={t('agent.archives.deleteTitle')}
        okText={t('app.delete')}
        cancelText={t('app.cancel')}
        okButtonProps={{ danger: true }}
        confirmLoading={deleteBusy}
        onCancel={() => setDeleteSession(undefined)}
        onOk={async () => {
          // 冲突后的人工重试采用已刷新版本，确认对象仍保持为原会话。
          if (deleteTarget && await perform(deleteTarget, onDelete) && mounted.current) {
            setDeleteSession((current) => current?.id === deleteTarget.id ? undefined : current)
          }
        }}
      >
        <p>{t('agent.archives.deleteDescription')}</p>
        <strong>{deleteTarget?.title}</strong>
        {deleteSession && failedSessionIds.has(deleteSession.id) ? <Alert type="error" showIcon title={t('agent.archives.operationFailed')} /> : null}
      </Modal>
    </div>
  )
}

function ArchiveError({ label, onRetry }: { label: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return <Alert className={styles.error} type="error" showIcon title={label} action={<Button size="small" onClick={onRetry}>{t('agent.archives.retry')}</Button>} />
}

function ArchiveLoading({ label }: { label: string }) {
  return <div className={styles.loading} role="status"><Spin size="small" /><span>{label}</span></div>
}

function formatArchiveDate(value?: string, locale?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale) : ''
}
