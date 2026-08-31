import { Drawer, Skeleton } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '#shared/ui'
import { useAgentWorkspaceBreakpoints } from '../model/useAgentWorkspaceBreakpoints.ts'
import { isActiveAgentRun, type AgentWorkspaceProps } from '../model/types.ts'
import { AgentComposer } from './AgentComposer.tsx'
import { AgentAttachmentPreview } from './AgentAttachmentPreview.tsx'
import { AgentConversation } from './AgentConversation.tsx'
import { AgentInspector } from './AgentInspector.tsx'
import { AgentSessionSidebar } from './AgentSessionSidebar.tsx'
import { AgentWorkspaceHeader } from './AgentWorkspaceHeader.tsx'
import styles from './AgentWorkspace.module.scss'

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const { t } = useTranslation()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const breakpoints = useAgentWorkspaceBreakpoints(workspaceRef)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [deleteSessionId, setDeleteSessionId] = useState<string>()
  const [previewAttachment, setPreviewAttachment] = useState<import('#entities/agent').AgentAttachment>()
  const selectedSession = props.sessions.find((session) => session.id === props.selected_session_id)
  const selectedModel = props.models.find((model) => model.id === props.selected_model_id)
  const runStatus = selectedSession?.run_status ?? 'idle'
  const active = isActiveAgentRun(runStatus)
  const activeRunElsewhere = props.active_run
    && props.active_run.session_id !== props.selected_session_id
    ? props.active_run
    : undefined
  const deleteSession = props.sessions.find((session) => session.id === deleteSessionId)

  useEffect(() => {
    if (!breakpoints.sessionsOverlay) setSessionsOpen(false)
  }, [breakpoints.sessionsOverlay])
  const sidebar = (
    <AgentSessionSidebar
      sessions={props.sessions}
      selectedSessionId={props.selected_session_id}
      disabled={props.busy || active || props.run_blocked}
      onCreate={() => { props.onCreateSession(); setSessionsOpen(false) }}
      onSelect={(id) => { props.onSelectSession(id); setSessionsOpen(false) }}
      onArchive={(id) => props.onArchiveSession(id)}
      onDelete={setDeleteSessionId}
      onClose={breakpoints.sessionsOverlay ? () => setSessionsOpen(false) : undefined}
    />
  )
  const inspector = (
    <AgentInspector
      inspector={props.inspector}
      disabled={props.busy || active || props.run_blocked}
      onContextCompressionPendingChange={props.onContextCompressionPendingChange}
      onRetryContext={props.onRetryContext}
      onRetryUsage={props.onRetryUsage}
      onApprovalBypassChange={props.onApprovalBypassChange}
      onClose={() => setInspectorOpen(false)}
    />
  )

  if (props.loading && props.sessions.length === 0) {
    return <div ref={workspaceRef} className={styles.workspace}><div className={styles.skeleton}><Skeleton active paragraph={{ rows: 10 }} /></div></div>
  }

  return (
    <div
      ref={workspaceRef}
      className={`${styles.workspace} ${inspectorOpen && !breakpoints.inspectorOverlay ? styles['has-inspector'] : ''} ${breakpoints.sessionsOverlay ? styles['has-sessions-overlay'] : ''}`}
    >
      {!breakpoints.sessionsOverlay ? sidebar : null}
      <section className={styles.main}>
        <AgentWorkspaceHeader
          selectedSession={selectedSession}
          runStatus={runStatus}
          activeRunElsewhere={activeRunElsewhere}
          busy={props.busy}
          sessionsOverlay={breakpoints.sessionsOverlay}
          inspectorOpen={inspectorOpen}
          onOpenSessions={() => setSessionsOpen(true)}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onReturnToActiveRun={props.onReturnToActiveRun}
          onStop={() => void props.onStop()}
        />
        <AgentConversation
          messages={props.messages}
          runStatus={runStatus}
          loading={props.loading}
          sessionKey={selectedSession?.id ?? 'new'}
          showTurnTokenUsage={props.show_turn_token_usage}
          onPreviewAttachment={setPreviewAttachment}
          onLoadAttachmentContent={props.onLoadAttachmentContent}
        />
        <AgentComposer
          value={props.draft}
          runStatus={runStatus}
          disabled={props.busy}
          submitDisabled={props.busy || props.run_blocked || props.resource_run_blocked || (!active && !props.model_runnable)}
          sourceContext={props.draft_source_context}
          resourceContext={props.resource_context}
          resourceChangeDisabled={props.busy
            || active
            || Boolean(props.active_run)
            || props.resource_context?.status === 'checking'}
          attachments={props.draft_attachments}
          supportsImages={props.supports_images}
          models={props.models}
          selectedModelId={props.selected_model_id}
          defaultModelId={props.default_model_id}
          selectedModelName={selectedSession?.model_name}
          selectedModelAlias={selectedSession?.model_alias}
          selectedProviderName={selectedSession?.provider_name}
          selectedReasoningLevel={props.selected_reasoning_level}
          supportedReasoningLevels={selectedModel?.supported_reasoning_levels ?? ['off']}
          modelSelectionDisabled={props.busy || active || props.run_blocked}
          reasoningSelectionDisabled={props.busy || active || props.run_blocked || !selectedModel?.runnable}
          onChange={props.onDraftChange}
          onAttachFiles={(files) => void props.onAttachFiles(files)}
          onRemoveAttachment={(clientId) => void props.onRemoveAttachment(clientId)}
          onRetryAttachment={(clientId) => void props.onRetryAttachment(clientId)}
          onPreviewAttachment={(item) => item.attachment && setPreviewAttachment(item.attachment)}
          onSend={(value, attachmentIds, sourceContext) => void props.onSend(value, attachmentIds, sourceContext)}
          onSteer={(value) => void props.onSteer(value)}
          onStop={() => void props.onStop()}
          onModelChange={props.onModelChange}
          onReasoningChange={props.onReasoningChange}
          onResetResponseOptions={props.onResetResponseOptions}
          onOpenSettings={props.onOpenSettings}
          onReplaceResourceBinding={props.onReplaceResourceBinding}
          onRemoveResourceBinding={props.onRemoveResourceBinding}
        />
      </section>
      {inspectorOpen && !breakpoints.inspectorOverlay ? inspector : null}
      <Drawer
        open={sessionsOpen && breakpoints.sessionsOverlay}
        aria-label={t('agent.sessions.title')}
        placement="left"
        size={280}
        className={styles.drawer}
        closable={false}
        destroyOnHidden
        onClose={() => setSessionsOpen(false)}
      >{sidebar}</Drawer>
      <Drawer
        open={inspectorOpen && breakpoints.inspectorOverlay}
        aria-label={t('agent.inspector.title')}
        placement="right"
        size={320}
        className={styles.drawer}
        closable={false}
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
      <AgentAttachmentPreview
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(undefined)}
        onLoad={props.onLoadAttachmentContent}
      />
    </div>
  )
}
