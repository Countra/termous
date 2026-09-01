import { Drawer, Skeleton } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const onDraftChange = useStableEventHandler(props.onDraftChange)
  const onAttachFiles = useStableEventHandler(props.onAttachFiles)
  const onRemoveAttachment = useStableEventHandler(props.onRemoveAttachment)
  const onRetryAttachment = useStableEventHandler(props.onRetryAttachment)
  const onLoadAttachmentContent = useStableEventHandler(props.onLoadAttachmentContent)
  const onSend = useStableEventHandler(props.onSend)
  const onQueueTurn = useStableEventHandler(props.onQueueTurn)
  const onQueuedTurnEditChange = useStableEventHandler(props.onQueuedTurnEditChange)
  const onRemoveQueuedTurnEditAttachment = useStableEventHandler(props.onRemoveQueuedTurnEditAttachment)
  const onSaveQueuedTurnEdit = useStableEventHandler(props.onSaveQueuedTurnEdit)
  const onCancelQueuedTurnEdit = useStableEventHandler(props.onCancelQueuedTurnEdit)
  const onBeginQueuedTurnEdit = useStableEventHandler(props.onBeginQueuedTurnEdit)
  const onDeleteQueuedTurn = useStableEventHandler(props.onDeleteQueuedTurn)
  const onMoveQueuedTurn = useStableEventHandler(props.onMoveQueuedTurn)
  const onSteerQueuedTurn = useStableEventHandler(props.onSteerQueuedTurn)
  const onResumeQueue = useStableEventHandler(props.onResumeQueue)
  const onStop = useStableEventHandler(props.onStop)
  const onModelChange = useStableEventHandler(props.onModelChange)
  const onReasoningChange = useStableEventHandler(props.onReasoningChange)
  const onApprovalModeChange = useStableEventHandler(props.onApprovalModeChange)
  const onResetResponseOptions = useStableEventHandler(props.onResetResponseOptions)
  const onOpenSettings = useStableEventHandler(props.onOpenSettings)
  const onReplaceResourceBinding = useStableEventHandler(props.onReplaceResourceBinding)
  const onRemoveResourceBinding = useStableEventHandler(props.onRemoveResourceBinding)
  const onPreviewDraftAttachment = useCallback((item: AgentWorkspaceProps['draft_attachments'][number]) => {
    if (item.attachment) setPreviewAttachment(item.attachment)
  }, [])
  const selectedSession = props.sessions.find((session) => session.id === props.selected_session_id)
  const selectedModel = props.models.find((model) => model.id === props.selected_model_id)
  const runStatus = selectedSession?.run_status ?? 'idle'
  const active = isActiveAgentRun(runStatus)
  const queueMode = active || props.queued_turns.some(({ state }) => state === 'queued')
  const activeRunElsewhere = props.active_run
    && props.active_run.session_id !== props.selected_session_id
    ? props.active_run
    : undefined
  const deleteSession = props.sessions.find((session) => session.id === deleteSessionId)
  const queuedSessionId = Object.entries(props.queued_turn_counts)
    .find(([, count]) => count > 0)?.[0]
  const queuedSessionElsewhere = queuedSessionId && queuedSessionId !== props.selected_session_id
    ? queuedSessionId
    : undefined
  const deleteSessionQueuedTurnCount = deleteSession
    ? props.queued_turn_counts[deleteSession.id] ?? 0
    : 0

  useEffect(() => {
    if (!breakpoints.sessionsOverlay) setSessionsOpen(false)
  }, [breakpoints.sessionsOverlay])
  const sidebar = (
    <AgentSessionSidebar
      sessions={props.sessions}
      selectedSessionId={props.selected_session_id}
      disabled={props.busy || props.run_blocked}
      queuedSessionId={queuedSessionId}
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
          queuedSessionElsewhere={Boolean(queuedSessionElsewhere)}
          stopDisabled={props.stop_busy}
          sessionsOverlay={breakpoints.sessionsOverlay}
          inspectorOpen={inspectorOpen}
          onOpenSessions={() => setSessionsOpen(true)}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onReturnToActiveRun={props.onReturnToActiveRun}
          onReturnToQueuedSession={() => {
            if (queuedSessionElsewhere) props.onSelectSession(queuedSessionElsewhere)
          }}
          onStop={() => void props.onStop()}
        />
        <AgentConversation
          messages={props.messages}
          runStatus={runStatus}
          loading={props.loading}
          sessionKey={selectedSession?.id ?? 'new'}
          showTurnTokenUsage={props.show_turn_token_usage}
          onPreviewAttachment={setPreviewAttachment}
          onLoadAttachmentContent={onLoadAttachmentContent}
        />
        <AgentComposer
          value={props.draft}
          runStatus={runStatus}
          disabled={props.busy || props.queue_busy}
          stopDisabled={props.stop_busy}
          submitDisabled={props.busy || props.queue_busy || props.run_blocked || props.resource_run_blocked || Boolean(queuedSessionElsewhere) || (!queueMode && !props.model_runnable)}
          sourceContext={props.draft_source_context}
          resourceContext={props.resource_context}
          resourceChangeDisabled={props.busy
            || queueMode
            || Boolean(props.active_run)
            || Boolean(queuedSessionElsewhere)
            || props.resource_context?.status === 'checking'}
          attachments={props.draft_attachments}
          queuedTurns={props.queued_turns}
          queueState={props.queue_state}
          queuedTurnEdit={props.queued_turn_edit}
          supportsImages={props.supports_images}
          models={props.models}
          selectedModelId={props.selected_model_id}
          defaultModelId={props.default_model_id}
          selectedModelName={selectedSession?.model_name}
          selectedModelAlias={selectedSession?.model_alias}
          selectedProviderName={selectedSession?.provider_name}
          selectedReasoningLevel={props.selected_reasoning_level}
          supportedReasoningLevels={selectedModel?.supported_reasoning_levels ?? ['off']}
          approvalPolicy={props.approval_policy}
          approvalModeDisabled={props.busy || active || Boolean(props.active_run) || props.run_blocked}
          modelSelectionDisabled={props.busy || queueMode || Boolean(queuedSessionElsewhere) || props.run_blocked}
          reasoningSelectionDisabled={props.busy || queueMode || Boolean(queuedSessionElsewhere) || props.run_blocked || !selectedModel?.runnable}
          onChange={onDraftChange}
          onAttachFiles={onAttachFiles}
          onRemoveAttachment={onRemoveAttachment}
          onRetryAttachment={onRetryAttachment}
          onPreviewAttachment={onPreviewDraftAttachment}
          onPreviewQueuedAttachment={setPreviewAttachment}
          onLoadQueuedAttachment={onLoadAttachmentContent}
          onSend={onSend}
          onQueueTurn={onQueueTurn}
          onQueuedTurnEditChange={onQueuedTurnEditChange}
          onRemoveQueuedTurnEditAttachment={onRemoveQueuedTurnEditAttachment}
          onSaveQueuedTurnEdit={onSaveQueuedTurnEdit}
          onCancelQueuedTurnEdit={onCancelQueuedTurnEdit}
          onBeginQueuedTurnEdit={onBeginQueuedTurnEdit}
          onDeleteQueuedTurn={onDeleteQueuedTurn}
          onMoveQueuedTurn={onMoveQueuedTurn}
          onSteerQueuedTurn={onSteerQueuedTurn}
          onResumeQueue={onResumeQueue}
          onStop={onStop}
          onModelChange={onModelChange}
          onReasoningChange={onReasoningChange}
          onApprovalModeChange={onApprovalModeChange}
          onResetResponseOptions={onResetResponseOptions}
          onOpenSettings={onOpenSettings}
          onReplaceResourceBinding={onReplaceResourceBinding}
          onRemoveResourceBinding={onRemoveResourceBinding}
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
        description={t(
          deleteSessionQueuedTurnCount > 0
            ? 'agent.sessions.deleteDescriptionWithQueue'
            : 'agent.sessions.deleteDescription',
          { title: deleteSession?.title, count: deleteSessionQueuedTurnCount },
        )}
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

function useStableEventHandler<Arguments extends unknown[], Result>(
  handler: (...args: Arguments) => Result,
) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  return useCallback((...args: Arguments) => handlerRef.current(...args), [])
}
