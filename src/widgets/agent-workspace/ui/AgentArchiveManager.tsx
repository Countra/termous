import { Alert, Button, Dropdown, Modal, Spin, Tooltip } from 'antd'
import { Archive, ArrowLeft, ArchiveRestore, MessageSquare, MoreHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAttachment, AgentSession, AgentSessionGroup } from '#entities/agent'
import { contextActionMenuPopupClassName } from '#shared/ui'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { AgentAttachmentPreview } from './AgentAttachmentPreview.tsx'
import { AgentConversation } from './AgentConversation.tsx'
import { AgentArchiveSessionList } from './AgentArchiveSessionList.tsx'
import styles from './AgentArchiveManager.module.scss'

export interface AgentArchiveManagerProps {
  open: boolean
  sessions: AgentSession[]
  groups?: AgentSessionGroup[]
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
      rootClassName="termous-modal-root"
      onCancel={props.onClose}
    >
      {props.open ? <ArchiveContents {...props} /> : null}
    </Modal>
  )
}

function ArchiveContents({
  sessions, groups, query, listLoading, listError, selectedSession, messages,
  previewLoading, previewError, pendingIds, showTurnTokenUsage, onQueryChange, onSelect,
  onReload, onReloadPreview, onRestore, onDelete, onLoadAttachmentContent,
}: AgentArchiveManagerProps) {
  const { t } = useTranslation()
  const [previewAttachment, setPreviewAttachment] = useState<AgentAttachment>()
  const [deleteSession, setDeleteSession] = useState<AgentSession>()
  const [pendingSessionIds, setPendingSessionIds] = useState<ReadonlySet<string>>(new Set())
  const [failedSessionIds, setFailedSessionIds] = useState<ReadonlySet<string>>(new Set())
  const operationsInFlight = useRef(new Set<string>())
  const mounted = useRef(true)
  const backButton = useRef<HTMLButtonElement>(null)
  const previewTitle = useRef<HTMLHeadingElement>(null)
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
    if (!selectedSessionId) return
    // 窄窗口聚焦返回按钮，宽窗口聚焦标题，避免把焦点交给已隐藏的按钮。
    if (backButton.current?.getClientRects().length) backButton.current.focus({ preventScroll: true })
    else previewTitle.current?.focus({ preventScroll: true })
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
          <AgentArchiveSessionList
            sessions={sessions}
            groups={groups}
            query={query}
            loading={listLoading}
            failed={Boolean(listError)}
            selectedId={selectedSessionId}
            onQueryChange={onQueryChange}
            onSelect={onSelect}
          />
          {listError ? (
            <ArchiveError label={t('agent.archives.listFailed')} onRetry={onReload} />
          ) : null}
        </section>
        <section className={styles.preview} aria-label={selectedSession?.title ?? t('agent.archives.select')}>
          {selectedSession ? (
            <>
              <div className={styles['preview-header']}>
                <Button ref={backButton} className={styles.back} type="text" icon={<ArrowLeft size={15} />} aria-label={t('agent.archives.back')} onClick={() => onSelect()} />
                <div className={styles['preview-heading']}>
                  <h2 ref={previewTitle} tabIndex={-1} className={styles['preview-title']} title={selectedSession.title}>{selectedSession.title}</h2>
                  <p className={styles.notice}>{t('agent.archives.readonly')}</p>
                </div>
                <div className={styles['preview-actions']}>
                  <Button size="small" icon={<ArchiveRestore size={14} />} loading={busy} onClick={() => void perform(selectedSession, onRestore)}>{t('agent.archives.restore')}</Button>
                  <Dropdown
                    trigger={['click']}
                    disabled={busy}
                    classNames={{ root: contextActionMenuPopupClassName }}
                    menu={{ items: [{ key: 'delete', danger: true, icon: <Trash2 size={14} />, label: t('app.delete') }], onClick: () => setDeleteSession(selectedSession) }}
                  >
                    <Tooltip title={t('agent.sessions.more')}>
                      <Button type="text" size="small" icon={<MoreHorizontal size={16} />} disabled={busy} aria-label={t('agent.sessions.more')} />
                    </Tooltip>
                  </Dropdown>
                </div>
              </div>
              {failedSessionIds.has(selectedSession.id) ? <Alert type="error" showIcon title={t('agent.archives.operationFailed')} /> : null}
              <div className={styles['preview-body']}>
                {previewError ? <ArchiveError label={t('agent.archives.previewFailed')} onRetry={onReloadPreview} /> : previewLoading ? (
                  <ArchiveLoading label={t('agent.archives.loadingPreview')} />
                ) : messages.length === 0 ? (
                  <div className={styles.placeholder}><MessageSquare size={24} aria-hidden="true" /><p>{t('agent.archives.emptyHistory')}</p></div>
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
              </div>
            </>
          ) : (
            <div className={styles['preview-body']}>
              <div className={styles.placeholder}>
                <MessageSquare size={28} aria-hidden="true" />
                <p>{t('agent.archives.select')}</p>
                <span>{t('agent.archives.readonly')}</span>
              </div>
            </div>
          )}
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
