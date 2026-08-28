import { Bot, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { Button, Drawer, Select, Skeleton, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '#shared/ui'
import { useAgentWorkspaceBreakpoints } from '../model/useAgentWorkspaceBreakpoints.ts'
import { isActiveAgentRun, type AgentWorkspaceProps } from '../model/types.ts'
import { AgentComposer } from './AgentComposer.tsx'
import { AgentConversation } from './AgentConversation.tsx'
import { AgentInspector } from './AgentInspector.tsx'
import { AgentSessionSidebar } from './AgentSessionSidebar.tsx'
import styles from './AgentWorkspace.module.scss'

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const { t } = useTranslation()
  const breakpoints = useAgentWorkspaceBreakpoints()
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [deleteSessionId, setDeleteSessionId] = useState<string>()
  const selectedSession = props.sessions.find((session) => session.id === props.selected_session_id)
  const runStatus = selectedSession?.run_status ?? 'idle'
  const active = isActiveAgentRun(runStatus)
  const deleteSession = useMemo(
    () => props.sessions.find((session) => session.id === deleteSessionId),
    [deleteSessionId, props.sessions],
  )

  useEffect(() => {
    if (!breakpoints.sessionsOverlay) setSessionsOpen(false)
    if (!breakpoints.inspectorOverlay) setInspectorOpen(false)
  }, [breakpoints.inspectorOverlay, breakpoints.sessionsOverlay])
  const sidebar = (
    <AgentSessionSidebar
      sessions={props.sessions}
      selectedSessionId={props.selected_session_id}
      disabled={props.busy || active || props.run_blocked}
      onCreate={() => { props.onCreateSession(); setSessionsOpen(false) }}
      onSelect={(id) => { props.onSelectSession(id); setSessionsOpen(false) }}
      onArchive={(id) => props.onArchiveSession(id)}
      onDelete={setDeleteSessionId}
    />
  )
  const inspector = (
    <AgentInspector
      inspector={props.inspector}
      disabled={props.busy || active || props.run_blocked}
      onApprovalBypassChange={props.onApprovalBypassChange}
    />
  )

  if (props.loading && props.sessions.length === 0) {
    return <div className={styles.workspace}><div className={styles.skeleton}><Skeleton active paragraph={{ rows: 10 }} /></div></div>
  }

  return (
    <div className={`${styles.workspace} ${breakpoints.inspectorOverlay ? styles['has-inspector-overlay'] : ''} ${breakpoints.sessionsOverlay ? styles['has-sessions-overlay'] : ''}`}>
      {!breakpoints.sessionsOverlay ? sidebar : null}
      <section className={styles.main}>
        <header className={styles.header}>
          <div className={styles['header-title']}>
            {breakpoints.sessionsOverlay ? (
              <Tooltip title={t('agent.sessions.title')}><Button type="text" aria-label={t('agent.sessions.title')} icon={<PanelLeftOpen size={17} />} onClick={() => setSessionsOpen(true)} /></Tooltip>
            ) : null}
            <span className={styles['agent-mark']}><Bot size={16} /></span>
            <div><strong>{selectedSession?.title ?? t('agent.sessions.new')}</strong><span>{selectedSession ? selectedSession.model_name : t('agent.header.newSession')}</span></div>
          </div>
          <div className={styles['header-controls']}>
            <Tag
              className={`${styles['status-tag']} ${styles[`is-${runStatus.replace('_', '-')}`]}`}
              aria-live="polite"
            >
              {t(`agent.status.${runStatus}`)}
            </Tag>
            <Select
              value={props.selected_model_profile_id}
              placeholder={t('agent.header.selectModel')}
              disabled={props.busy || active || props.run_blocked}
              aria-label={t('agent.header.model')}
              options={props.models.map((model) => ({ value: model.id, label: model.name }))}
              onChange={props.onModelChange}
            />
            {breakpoints.inspectorOverlay ? (
              <Tooltip title={t('agent.inspector.title')}><Button type="text" aria-label={t('agent.inspector.title')} icon={<PanelRightOpen size={17} />} onClick={() => setInspectorOpen(true)} /></Tooltip>
            ) : null}
          </div>
        </header>
        <AgentConversation
          messages={props.messages}
          runStatus={runStatus}
          loading={props.loading}
          sessionKey={selectedSession?.id ?? 'new'}
        />
        <AgentComposer
          value={props.draft}
          runStatus={runStatus}
          disabled={props.busy}
          submitDisabled={props.busy || props.run_blocked}
          onChange={props.onDraftChange}
          onSend={(value) => void props.onSend(value)}
          onSteer={(value) => void props.onSteer(value)}
          onStop={() => void props.onStop()}
        />
      </section>
      {!breakpoints.inspectorOverlay ? inspector : null}
      <Drawer
        open={sessionsOpen && breakpoints.sessionsOverlay}
        title={t('agent.sessions.title')}
        placement="left"
        size={280}
        className={styles.drawer}
        destroyOnHidden
        onClose={() => setSessionsOpen(false)}
      >{sidebar}</Drawer>
      <Drawer
        open={inspectorOpen && breakpoints.inspectorOverlay}
        title={t('agent.inspector.title')}
        placement="right"
        size={320}
        className={styles.drawer}
        destroyOnHidden
        onClose={() => setInspectorOpen(false)}
      >{inspector}</Drawer>
      <ConfirmDialog
        open={Boolean(deleteSession)}
        title={t('agent.sessions.deleteTitle')}
        description={t('agent.sessions.deleteDescription', { title: deleteSession?.title })}
        confirmLabel={t('app.delete')}
        danger
        confirmLoading={props.busy}
        onCancel={() => setDeleteSessionId(undefined)}
        onConfirm={() => {
          if (!deleteSession) return
          props.onDeleteSession(deleteSession.id)
          setDeleteSessionId(undefined)
        }}
      />
    </div>
  )
}
