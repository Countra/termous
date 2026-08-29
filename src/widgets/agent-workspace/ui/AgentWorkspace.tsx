import { Bot, CornerUpLeft, PanelLeftOpen, PanelRightOpen, Settings2, Square } from 'lucide-react'
import { Button, Drawer, Select, Skeleton, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '#shared/ui'
import { useAgentWorkspaceBreakpoints } from '../model/useAgentWorkspaceBreakpoints.ts'
import {
  isActiveAgentRun,
  type AgentWorkspaceModelUnavailableReason,
  type AgentWorkspaceProps,
} from '../model/types.ts'
import { AgentComposer } from './AgentComposer.tsx'
import { AgentAttachmentPreview } from './AgentAttachmentPreview.tsx'
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
  const [previewAttachment, setPreviewAttachment] = useState<import('#entities/agent').AgentAttachment>()
  const selectedSession = props.sessions.find((session) => session.id === props.selected_session_id)
  const modelById = useMemo(
    () => new Map(props.models.map((model) => [model.id, model])),
    [props.models],
  )
  const modelOptions = useMemo(
    () => groupModelOptions(props.models, t),
    [props.models, t],
  )
  const selectedModel = props.selected_model_id
    ? modelById.get(props.selected_model_id)
    : undefined
  const runStatus = selectedSession?.run_status ?? 'idle'
  const active = isActiveAgentRun(runStatus)
  const hasRunnableModels = props.models.some(({ runnable }) => runnable)
  const activeRunElsewhere = props.active_run
    && props.active_run.session_id !== props.selected_session_id
  const displayedRunStatus = activeRunElsewhere ? props.active_run!.status : runStatus
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
      onContextCompressionPendingChange={props.onContextCompressionPendingChange}
      onRetryContext={props.onRetryContext}
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
            <div>
              <strong>{selectedSession?.title ?? t('agent.sessions.new')}</strong>
              <span>{selectedSession
                ? sessionModelLabel(selectedSession.model_name, selectedSession.provider_name)
                : t('agent.header.newSession')}</span>
            </div>
          </div>
          <div className={styles['header-controls']}>
            <Tag
              className={`${styles['status-tag']} ${styles[`is-${displayedRunStatus.replace('_', '-')}`]}`}
              aria-live="polite"
            >
              {t(`agent.status.${displayedRunStatus}`)}
            </Tag>
            {activeRunElsewhere ? (
              <div className={styles['active-run-actions']}>
                <Tooltip title={t('agent.header.returnToActiveRun')}>
                  <Button
                    type="text"
                    size="small"
                    aria-label={t('agent.header.returnToActiveRun')}
                    icon={<CornerUpLeft size={14} />}
                    onClick={props.onReturnToActiveRun}
                  />
                </Tooltip>
                <Tooltip title={t('agent.composer.stop')}>
                  <Button
                    type="text"
                    size="small"
                    danger
                    aria-label={t('agent.composer.stop')}
                    icon={<Square size={12} fill="currentColor" />}
                    disabled={props.busy || props.active_run?.status === 'stopping'}
                    onClick={() => void props.onStop()}
                  />
                </Tooltip>
              </div>
            ) : null}
            <Select
              value={props.selected_model_id}
              placeholder={t('agent.header.selectModel')}
              disabled={props.busy || active || props.run_blocked}
              aria-label={t('agent.header.model')}
              showSearch
              options={modelOptions}
              filterOption={(input, option) => (
                isSearchableModelOption(option)
                  && option.search_text.includes(input.trim().toLocaleLowerCase())
              )}
              onChange={props.onModelChange}
            />
            {!props.model_runnable ? (
              <Tooltip title={modelUnavailableHint(selectedModel?.unavailable_reason, t)}>
                <Tag color="warning">
                  {modelUnavailableLabel(selectedModel?.unavailable_reason, t)}
                </Tag>
              </Tooltip>
            ) : null}
            {!hasRunnableModels ? (
              <Button
                type="text"
                size="small"
                className={styles['model-settings-action']}
                aria-label={t('agent.header.configureProvider')}
                icon={<Settings2 size={14} aria-hidden="true" />}
                onClick={props.onOpenSettings}
              >
                <span className={styles['model-settings-action-label']}>
                  {t('agent.header.configureProvider')}
                </span>
              </Button>
            ) : null}
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
          onPreviewAttachment={setPreviewAttachment}
        />
        <AgentComposer
          value={props.draft}
          runStatus={runStatus}
          disabled={props.busy}
          submitDisabled={props.busy || props.run_blocked || (!active && !props.model_runnable)}
          sourceContext={props.draft_source_context}
          attachments={props.draft_attachments}
          supportsImages={props.supports_images}
          onChange={props.onDraftChange}
          onAttachFiles={(files) => void props.onAttachFiles(files)}
          onRemoveAttachment={(clientId) => void props.onRemoveAttachment(clientId)}
          onRetryAttachment={(clientId) => void props.onRetryAttachment(clientId)}
          onPreviewAttachment={(item) => item.attachment && setPreviewAttachment(item.attachment)}
          onSend={(value, attachmentIds, sourceContext) => void props.onSend(value, attachmentIds, sourceContext)}
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
      <AgentAttachmentPreview
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(undefined)}
        onLoad={props.onLoadAttachmentContent}
      />
    </div>
  )
}

function groupModelOptions(
  models: AgentWorkspaceProps['models'],
  t: (key: string) => string,
) {
  const providers = new Map<string, AgentWorkspaceProps['models']>()
  for (const model of models) {
    const items = providers.get(model.provider_name) ?? []
    items.push(model)
    providers.set(model.provider_name, items)
  }
  return Array.from(providers, ([provider, items]) => ({
    label: provider,
    title: provider,
    options: items.map((model) => ({
      value: model.id,
      disabled: !model.runnable,
      label: `${model.name} · ${provider} · ${model.remote_model_id}${model.runnable
        ? ''
        : ` · ${modelUnavailableLabel(model.unavailable_reason, t)}`}`,
      search_text: `${model.name} ${provider} ${model.remote_model_id}`.toLocaleLowerCase(),
    })),
  }))
}

function sessionModelLabel(modelName: string, providerName?: string) {
  return providerName ? `${modelName} · ${providerName}` : modelName
}

function isSearchableModelOption(value: unknown): value is { search_text: string } {
  return Boolean(
    value
    && typeof value === 'object'
    && 'search_text' in value
    && typeof value.search_text === 'string',
  )
}

function modelUnavailableLabel(
  reason: AgentWorkspaceModelUnavailableReason | undefined,
  t: (key: string) => string,
) {
  return reason
    ? t(`agent.header.modelUnavailableReason.${reason}`)
    : t('agent.header.modelUnavailable')
}

function modelUnavailableHint(
  reason: AgentWorkspaceModelUnavailableReason | undefined,
  t: (key: string) => string,
) {
  return reason
    ? t(`agent.header.modelUnavailableHint.${reason}`)
    : t('agent.header.modelUnavailableHint.unknown')
}
