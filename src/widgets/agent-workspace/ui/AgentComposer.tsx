import { ArrowUp, Check, CornerDownLeft, Eye, FileCode2, Paperclip, Pencil, RefreshCw, Square, Waypoints, X } from 'lucide-react'
import { Button, Input, Tooltip, type GetRef } from 'antd'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { agentResourceBindingKey } from '#entities/agent'
import type {
  AgentQueuedTurnMovePlacement,
  AgentReasoningLevel,
  AgentSourceContext,
} from '#entities/agent'
import {
  AgentApprovalModeControl,
  type AgentApprovalMode,
  type AgentApprovalPolicyState,
} from '#features/agent-approval-policy'
import type {
  AgentWorkspaceDraftAttachment,
  AgentWorkspaceProps,
  AgentWorkspaceResourceContext,
  AgentWorkspaceRunStatus,
} from '../model/types.ts'
import { isActiveAgentRun } from '../model/types.ts'
import { useAgentComposerHistory } from '../model/useAgentComposerHistory.ts'
import { AgentResponseOptionsMenu } from './AgentResponseOptionsMenu.tsx'
import { AgentResourceBindingControl } from './AgentResourceBindingControl.tsx'
import { AgentAttachmentThumbnail } from './AgentAttachmentThumbnail.tsx'
import { AgentTerminalReferenceCard } from './AgentTerminalReferenceCard.tsx'
import { AgentQueuedTurnList } from './AgentQueuedTurnList.tsx'
import styles from './AgentComposer.module.scss'

export const AgentComposer = memo(function AgentComposer({
  value,
  focusKey,
  paneActive = true,
  sessionKey,
  inputHistory,
  runStatus,
  disabled,
  stopDisabled,
  submitDisabled,
  sourceContext,
  resourceContexts = [],
  resourceChangeDisabled,
  resourceRecoveryDisabled = false,
  queueExecutionBlocked = false,
  attachments,
  queuedTurns,
  queueState,
  queuedTurnEdit,
  supportsImages,
  models,
  selectedModelId,
  selectedModelName,
  selectedModelAlias,
  selectedProviderName,
  defaultModelId,
  selectedReasoningLevel,
  supportedReasoningLevels,
  approvalPolicy,
  approvalModeDisabled,
  modelSelectionDisabled,
  reasoningSelectionDisabled,
  onChange,
  onAttachFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onPreviewAttachment,
  onPreviewQueuedAttachment,
  onLoadQueuedAttachment,
  onSend,
  onQueueTurn,
  onQueuedTurnEditChange,
  onRemoveQueuedTurnEditAttachment,
  onSaveQueuedTurnEdit,
  onCancelQueuedTurnEdit,
  onBeginQueuedTurnEdit,
  onDeleteQueuedTurn,
  onMoveQueuedTurn,
  onSteerQueuedTurn,
  onResumeQueue,
  onStop,
  onModelChange,
  onReasoningChange,
  onApprovalModeChange,
  onResetResponseOptions,
  onOpenSettings,
  onReplaceResourceBinding,
  onRemoveResourceBinding,
  onRecoverResourceBinding,
  onCancelResourceRecovery,
}: {
  value: string
  focusKey?: number
  paneActive?: boolean
  sessionKey: string
  inputHistory: readonly string[]
  runStatus: AgentWorkspaceRunStatus
  disabled: boolean
  stopDisabled: boolean
  submitDisabled: boolean
  sourceContext?: AgentSourceContext
  resourceContexts?: AgentWorkspaceResourceContext[]
  resourceChangeDisabled: boolean
  resourceRecoveryDisabled?: boolean
  queueExecutionBlocked?: boolean
  attachments: AgentWorkspaceDraftAttachment[]
  queuedTurns: AgentWorkspaceProps['queued_turns']
  queueState?: AgentWorkspaceProps['queue_state']
  queuedTurnEdit?: AgentWorkspaceProps['queued_turn_edit']
  supportsImages: boolean
  models: AgentWorkspaceProps['models']
  selectedModelId?: string
  selectedModelName?: string
  selectedModelAlias?: string
  selectedProviderName?: string
  defaultModelId?: string
  selectedReasoningLevel: AgentReasoningLevel
  supportedReasoningLevels: AgentReasoningLevel[]
  approvalPolicy: AgentApprovalPolicyState
  approvalModeDisabled: boolean
  modelSelectionDisabled: boolean
  reasoningSelectionDisabled: boolean
  onChange: (value: string) => void
  onAttachFiles: (files: File[]) => void
  onRemoveAttachment: (clientId: string) => void
  onRetryAttachment: (clientId: string) => void
  onPreviewAttachment: (attachment: AgentWorkspaceDraftAttachment) => void
  onPreviewQueuedAttachment: (attachment: import('#entities/agent').AgentAttachment) => void
  onLoadQueuedAttachment: (attachment: import('#entities/agent').AgentAttachment, signal?: AbortSignal) => Promise<Blob>
  onSend: (value: string, attachmentIds: string[], sourceContext?: AgentSourceContext) => void
  onQueueTurn: (value: string, attachmentIds: string[], sourceContext?: AgentSourceContext) => void
  onQueuedTurnEditChange: (value: string) => void
  onRemoveQueuedTurnEditAttachment: (attachmentId: string) => void
  onSaveQueuedTurnEdit: (attachmentIds: string[]) => void
  onCancelQueuedTurnEdit: () => void
  onBeginQueuedTurnEdit: (turnId: string) => void
  onDeleteQueuedTurn: (turnId: string) => void
  onMoveQueuedTurn: (
    turnId: string,
    targetTurnId: string,
    placement: AgentQueuedTurnMovePlacement,
  ) => Promise<boolean>
  onSteerQueuedTurn: (turnId: string) => void
  onResumeQueue: () => void
  onStop: () => void
  onModelChange: (modelId: string) => void
  onReasoningChange: (reasoningLevel: AgentReasoningLevel) => void
  onApprovalModeChange: (mode: AgentApprovalMode) => Promise<void>
  onResetResponseOptions: () => void
  onOpenSettings: () => void
  onReplaceResourceBinding: AgentWorkspaceProps['onReplaceResourceBinding']
  onRemoveResourceBinding: AgentWorkspaceProps['onRemoveResourceBinding']
  onRecoverResourceBinding?: AgentWorkspaceProps['onRecoverResourceBinding']
  onCancelResourceRecovery?: AgentWorkspaceProps['onCancelResourceRecovery']
}) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textAreaRef = useRef<GetRef<typeof Input.TextArea>>(null)
  const focusedKeyRef = useRef<number | undefined>(undefined)
  const active = isActiveAgentRun(runStatus)
  const queueMode = active || queuedTurns.some(({ state }) => state === 'queued')
  const editing = Boolean(queuedTurnEdit)
  useEffect(() => {
    if (!focusKey || focusedKeyRef.current === focusKey || !paneActive || (disabled && (!active || editing))) return
    focusedKeyRef.current = focusKey
    textAreaRef.current?.focus({ preventScroll: true })
  }, [active, disabled, editing, focusKey, paneActive])
  const inputValue = queuedTurnEdit?.text ?? value
  const inputHistoryNavigation = useAgentComposerHistory({
    sessionKey, value: inputValue, history: inputHistory, disabled: editing, onChange,
  })
  const editingTurn = queuedTurnEdit
    ? queuedTurns.find(({ id }) => id === queuedTurnEdit.turn_id)
    : undefined
  const retainedAttachments = editingTurn?.attachments.filter(({ id }) => (
    queuedTurnEdit?.retained_attachment_ids.includes(id)
  )) ?? []
  const rawSourceContext = editing ? editingTurn?.source_context : sourceContext
  // 旧连接来源说明不再作为草稿或附件；连接展示统一由持久化引用驱动。
  const effectiveSourceContext = rawSourceContext?.kind === 'workbench' || rawSourceContext?.kind === 'files' ? undefined : rawSourceContext
  const attachmentsPending = attachments.some(({ phase }) => phase !== 'ready')
  const unsupportedImages = !supportsImages && attachments.some(({ kind, phase }) => kind === 'image' && phase === 'ready')
  const attachmentInputDisabled = disabled || attachments.length + retainedAttachments.length >= 8
  const blocked = (editing ? disabled : submitDisabled) || attachmentsPending || unsupportedImages
  const submit = () => {
    if (!inputValue.trim() || blocked || runStatus === 'stopping') return
    inputHistoryNavigation.reset()
    const attachmentIds = attachments.flatMap(({ attachment }) => attachment ? [attachment.id] : [])
    if (editing) onSaveQueuedTurnEdit(attachmentIds)
    else if (queueMode) onQueueTurn(inputValue, attachmentIds, effectiveSourceContext)
    else onSend(inputValue, attachmentIds, effectiveSourceContext)
  }
  return (
    <div className={styles.composer}>
      <AgentQueuedTurnList
        turns={queuedTurns}
        queueState={queueState}
        disabled={disabled}
        canExecute={active && runStatus !== 'stopping' && !submitDisabled}
        resumeDisabled={queueExecutionBlocked}
        editingTurnId={queuedTurnEdit?.turn_id}
        onEdit={onBeginQueuedTurnEdit}
        onExecute={onSteerQueuedTurn}
        onDelete={onDeleteQueuedTurn}
        onMove={onMoveQueuedTurn}
        onResume={onResumeQueue}
      />
      <div className={styles['composer-input']}>
        {editing ? (
          <div className={styles['edit-status']}>
            <span><Pencil size={12} aria-hidden="true" />{t('agent.queue.editing')}</span>
            <Button type="text" size="small" disabled={disabled} onClick={onCancelQueuedTurnEdit}>
              {t('app.cancel')}
            </Button>
          </div>
        ) : null}
        {resourceContexts.length > 0 || effectiveSourceContext || attachments.length > 0 || retainedAttachments.length > 0 ? (
          <div className={styles['composer-tray']}>
            {resourceContexts.map((resourceContext) => (
              <AgentResourceBindingControl
                key={`${sessionKey}:${agentResourceBindingKey(resourceContext.binding)}`}
                context={resourceContext}
                disabled={resourceChangeDisabled}
                onReplace={onReplaceResourceBinding}
                onRemove={() => onRemoveResourceBinding(resourceContext.binding.kind)}
                recoveryDisabled={resourceRecoveryDisabled}
                onRecover={onRecoverResourceBinding}
                onCancelRecovery={onCancelResourceRecovery}
              />
            ))}
            {effectiveSourceContext ? (
              <div className={styles['source-context']}>
                <Waypoints size={13} aria-hidden="true" />
                <span>{effectiveSourceContext.title}</span>
              </div>
            ) : null}
            {attachments.length > 0 ? (
              <div className={styles.attachments} role="list" aria-label={t('agent.attachments.title')}>
                {attachments.map((item) => item.origin ? (
                  <AgentTerminalReferenceCard key={item.client_id} origin={item.origin} listItem
                    disabled={disabled || item.phase === 'deleting'}
                    status={item.phase === 'ready' ? undefined : attachmentStateLabel(item, t)}
                    onPreview={() => onPreviewAttachment(item)}
                    onRemove={() => onRemoveAttachment(item.client_id)}
                    onRetry={item.phase === 'failed' ? () => onRetryAttachment(item.client_id) : undefined} />
                ) : (
                  <div key={item.client_id} className={styles.attachment} data-kind={item.kind} data-phase={item.phase} role="listitem">
                    {item.kind === 'image' ? (
                      <button
                        type="button"
                        className={styles['attachment-thumbnail']}
                        disabled={disabled || item.phase !== 'ready' || !item.attachment}
                        aria-label={t('agent.attachments.previewName', { name: item.name })}
                        title={item.name}
                        onClick={() => onPreviewAttachment(item)}
                      >
                        <AgentAttachmentThumbnail
                          className={styles['attachment-thumbnail-media']}
                          source={{ kind: 'local', blob: item.file }}
                          alt={item.name}
                        />
                      </button>
                    ) : (
                      <span className={styles['attachment-icon']} aria-hidden="true">
                        <FileCode2 size={14} />
                      </span>
                    )}
                    <span className={styles['attachment-copy']}>
                      <strong title={item.name}>{item.name}</strong>
                      <small>{attachmentStateLabel(item, t)}</small>
                    </span>
                    {item.kind === 'text' && item.phase === 'ready' ? (
                      <Tooltip title={t('agent.attachments.preview')}>
                        <Button type="text" size="small" disabled={disabled} aria-label={t('agent.attachments.previewName', { name: item.name })} icon={<Eye size={13} />} onClick={() => onPreviewAttachment(item)} />
                      </Tooltip>
                    ) : null}
                    {item.phase === 'failed' ? (
                      <Tooltip title={t('app.retry')}>
                        <Button type="text" size="small" disabled={disabled} aria-label={t('agent.attachments.retryName', { name: item.name })} icon={<RefreshCw size={13} />} onClick={() => onRetryAttachment(item.client_id)} />
                      </Tooltip>
                    ) : null}
                    <Tooltip title={item.phase === 'uploading'
                      ? t('agent.attachments.cancel')
                      : t('app.remove')}>
                      <Button type="text" size="small" disabled={disabled || item.phase === 'deleting'} aria-label={t('agent.attachments.removeName', { name: item.name })} icon={<X size={13} />} onClick={() => onRemoveAttachment(item.client_id)} />
                    </Tooltip>
                  </div>
                ))}
              </div>
            ) : null}
            {retainedAttachments.map((attachment) => attachment.origin ? (
              <AgentTerminalReferenceCard key={attachment.id} origin={attachment.origin} disabled={disabled}
                onPreview={() => onPreviewQueuedAttachment(attachment)}
                onRemove={() => onRemoveQueuedTurnEditAttachment(attachment.id)} />
            ) : (
              <div key={attachment.id} className={styles.attachment} role="group" aria-label={attachment.original_name}>
                {attachment.kind === 'image' ? (
                  <button
                    type="button"
                    className={styles['attachment-thumbnail']}
                    aria-label={t('agent.attachments.previewName', { name: attachment.original_name })}
                    title={attachment.original_name}
                    onClick={() => onPreviewQueuedAttachment(attachment)}
                  >
                    <AgentAttachmentThumbnail
                      className={styles['attachment-thumbnail-media']}
                      source={{ kind: 'remote', attachment, load: onLoadQueuedAttachment }}
                      alt={attachment.original_name}
                    />
                  </button>
                ) : (
                  <span className={styles['attachment-icon']} aria-hidden="true"><FileCode2 size={14} /></span>
                )}
                <span className={styles['attachment-copy']}><strong title={attachment.original_name}>{attachment.original_name}</strong></span>
                {attachment.kind === 'text' ? <Tooltip title={t('agent.attachments.preview')}>
                  <Button type="text" size="small" aria-label={t('agent.attachments.previewName', { name: attachment.original_name })} icon={<Eye size={13} />} onClick={() => onPreviewQueuedAttachment(attachment)} />
                </Tooltip> : null}
                <Tooltip title={t('app.remove')}>
                  <Button type="text" size="small" aria-label={t('agent.attachments.removeName', { name: attachment.original_name })} icon={<X size={13} />} onClick={() => onRemoveQueuedTurnEditAttachment(attachment.id)} />
                </Tooltip>
              </div>
            ))}
          </div>
        ) : null}
        {unsupportedImages ? (
          <div className={styles['attachment-warning']} role="alert">{t('agent.attachments.imageModelUnsupported')}</div>
        ) : null}
        <Input.TextArea
          ref={textAreaRef}
          className={styles['composer-textarea']}
          variant="borderless"
          autoSize={{ minRows: 2, maxRows: 8 }}
          value={inputValue}
          disabled={disabled && (!active || editing)}
          placeholder={t(queueMode ? 'agent.composer.queuePlaceholder' : 'agent.composer.placeholder')}
          onChange={(event) => {
            inputHistoryNavigation.reset()
            if (editing) onQueuedTurnEditChange(event.target.value)
            else onChange(event.target.value)
          }}
          onPointerDown={inputHistoryNavigation.reset}
          onCompositionStart={inputHistoryNavigation.reset}
          onPaste={(event) => {
            if (attachmentInputDisabled) return
            const files = clipboardAttachmentFiles(event.clipboardData)
            if (files.length === 0) return
            event.preventDefault()
            onAttachFiles(files)
          }}
          onKeyDown={(event) => {
            inputHistoryNavigation.onKeyDown(event)
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className={styles['composer-actions']}>
          <div className={styles['composer-secondary-actions']}>
            <>
                <input
                  ref={fileInputRef}
                  className={styles['file-input']}
                  type="file"
                  multiple
                  tabIndex={-1}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? [])
                    event.currentTarget.value = ''
                    if (files.length > 0) onAttachFiles(files)
                  }}
                />
                <Tooltip title={t('agent.attachments.add')}>
                  <Button
                    type="text"
                    className={styles['composer-attachment-action']}
                    aria-label={t('agent.attachments.add')}
                    icon={<Paperclip size={15} />}
                    disabled={attachmentInputDisabled}
                    onClick={() => fileInputRef.current?.click()}
                  />
                </Tooltip>
            </>
            <AgentApprovalModeControl
              policy={approvalPolicy}
              disabled={approvalModeDisabled}
              onChange={onApprovalModeChange}
            />
          </div>
          <div className={styles['composer-primary-actions']}>
            <AgentResponseOptionsMenu
              models={models}
              selectedModelId={selectedModelId}
              fallbackModelName={selectedModelName}
              fallbackModelAlias={selectedModelAlias}
              fallbackProviderName={selectedProviderName}
              selectedReasoningLevel={selectedReasoningLevel}
              supportedReasoningLevels={supportedReasoningLevels}
              defaultModelId={defaultModelId}
              modelSelectionDisabled={modelSelectionDisabled}
              reasoningSelectionDisabled={reasoningSelectionDisabled}
              onModelChange={onModelChange}
              onReasoningChange={onReasoningChange}
              onReset={onResetResponseOptions}
              onOpenSettings={onOpenSettings}
            />
            {active && !editing ? (
              <Tooltip title={t('agent.composer.stop')}>
                <Button className={styles['composer-stop']} danger aria-label={t('agent.composer.stop')} icon={<Square size={12} fill="currentColor" />} disabled={stopDisabled || runStatus === 'stopping'} onClick={onStop} />
              </Tooltip>
            ) : null}
            <Tooltip title={t(editing ? 'app.save' : queueMode ? 'agent.composer.queue' : 'agent.composer.send')}>
              <Button
                type="primary"
                className={styles['composer-submit']}
                aria-label={t(editing ? 'app.save' : queueMode ? 'agent.composer.queue' : 'agent.composer.send')}
                icon={editing ? <Check size={15} /> : queueMode ? <CornerDownLeft size={15} /> : <ArrowUp size={16} />}
                disabled={blocked || !inputValue.trim() || runStatus === 'stopping'}
                onClick={submit}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
})

function attachmentStateLabel(
  attachment: AgentWorkspaceDraftAttachment,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (attachment.phase === 'uploading') return t('agent.attachments.uploading')
  if (attachment.phase === 'deleting') return t('agent.attachments.deleting')
  if (attachment.phase === 'failed') {
    return t(`agent.attachments.error.${attachment.error_code ?? 'unknown'}`, {
      defaultValue: t('agent.attachments.error.unknown'),
    })
  }
  return t('agent.attachments.size', { size: formatAttachmentBytes(attachment.size_bytes) })
}

function formatAttachmentBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function clipboardAttachmentFiles(clipboardData: DataTransfer) {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile()
      return file ? [file] : []
    })
  const files = itemFiles.length > 0
    ? itemFiles
    : Array.from(clipboardData.files)
  return files.map(normalizeClipboardAttachmentName)
}

function normalizeClipboardAttachmentName(file: File, index: number) {
  if (file.name.trim()) return file
  const normalizedMIMEType = file.type.trim().toLowerCase()
  const extension = clipboardAttachmentExtension(normalizedMIMEType)
  const baseName = normalizedMIMEType.startsWith('image/') ? 'pasted-image' : 'pasted-attachment'
  const suffix = index === 0 ? '' : `-${index + 1}`
  return new File([file], `${baseName}${suffix}${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  })
}

function clipboardAttachmentExtension(mimeType: string) {
  switch (mimeType) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'text/plain': return '.txt'
    default: return ''
  }
}
