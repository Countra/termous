import { ArrowUp, CornerDownLeft, Eye, FileCode2, Image, Paperclip, RefreshCw, Square, Waypoints, X } from 'lucide-react'
import { Button, Input, Tooltip } from 'antd'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSourceContext } from '#entities/agent'
import type {
  AgentWorkspaceDraftAttachment,
  AgentWorkspaceProps,
  AgentWorkspaceRunStatus,
} from '../model/types.ts'
import { isActiveAgentRun } from '../model/types.ts'
import { AgentModelSelector } from './AgentModelSelector.tsx'
import styles from './AgentComposer.module.scss'

export function AgentComposer({
  value,
  runStatus,
  disabled,
  submitDisabled,
  sourceContext,
  attachments,
  supportsImages,
  models,
  selectedModelId,
  selectedModelName,
  selectedProviderName,
  modelSelectionDisabled,
  onChange,
  onAttachFiles,
  onRemoveAttachment,
  onRetryAttachment,
  onPreviewAttachment,
  onSend,
  onSteer,
  onStop,
  onModelChange,
  onOpenSettings,
}: {
  value: string
  runStatus: AgentWorkspaceRunStatus
  disabled: boolean
  submitDisabled: boolean
  sourceContext?: AgentSourceContext
  attachments: AgentWorkspaceDraftAttachment[]
  supportsImages: boolean
  models: AgentWorkspaceProps['models']
  selectedModelId?: string
  selectedModelName?: string
  selectedProviderName?: string
  modelSelectionDisabled: boolean
  onChange: (value: string) => void
  onAttachFiles: (files: File[]) => void
  onRemoveAttachment: (clientId: string) => void
  onRetryAttachment: (clientId: string) => void
  onPreviewAttachment: (attachment: AgentWorkspaceDraftAttachment) => void
  onSend: (value: string, attachmentIds: string[], sourceContext?: AgentSourceContext) => void
  onSteer: (value: string) => void
  onStop: () => void
  onModelChange: (modelId: string) => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const active = isActiveAgentRun(runStatus)
  const attachmentsPending = attachments.some(({ phase }) => phase !== 'ready')
  const unsupportedImages = !supportsImages && attachments.some(({ kind, phase }) => kind === 'image' && phase === 'ready')
  const blocked = submitDisabled || attachmentsPending || unsupportedImages
  const submit = () => {
    if (!value.trim() || blocked || runStatus === 'stopping') return
    if (active) onSteer(value)
    else onSend(value, attachments.flatMap(({ attachment }) => attachment ? [attachment.id] : []), sourceContext)
  }
  return (
    <div className={styles.composer}>
      <div className={styles['composer-input']}>
        {active || (sourceContext && !active) || (attachments.length > 0 && !active) ? (
          <div className={styles['composer-tray']}>
            {active ? (
              <div className={styles['composer-context']}><Waypoints size={13} />{t('agent.composer.steerHint')}</div>
            ) : null}
            {sourceContext && !active ? (
              <div className={styles['source-context']}>
                <Waypoints size={13} aria-hidden="true" />
                <span>{sourceContext.title}</span>
              </div>
            ) : null}
            {attachments.length > 0 && !active ? (
              <div className={styles.attachments} role="list" aria-label={t('agent.attachments.title')}>
                {attachments.map((item) => (
                  <div key={item.client_id} className={styles.attachment} data-phase={item.phase} role="listitem">
                    <span className={styles['attachment-icon']} aria-hidden="true">
                      {item.kind === 'image' ? <Image size={14} /> : <FileCode2 size={14} />}
                    </span>
                    <span className={styles['attachment-copy']}>
                      <strong title={item.name}>{item.name}</strong>
                      <small>{attachmentStateLabel(item, t)}</small>
                    </span>
                    {item.phase === 'ready' ? (
                      <Tooltip title={t('agent.attachments.preview')}>
                        <Button type="text" size="small" disabled={disabled} aria-label={t('agent.attachments.previewName', { name: item.name })} icon={<Eye size={13} />} onClick={() => onPreviewAttachment(item)} />
                      </Tooltip>
                    ) : null}
                    {item.phase === 'failed' ? (
                      <Tooltip title={t('app.retry')}>
                        <Button type="text" size="small" disabled={disabled} aria-label={t('agent.attachments.retryName', { name: item.name })} icon={<RefreshCw size={13} />} onClick={() => onRetryAttachment(item.client_id)} />
                      </Tooltip>
                    ) : null}
                    <Tooltip title={t(item.phase === 'uploading' ? 'agent.attachments.cancel' : 'app.remove')}>
                      <Button type="text" size="small" disabled={disabled || item.phase === 'deleting'} aria-label={t('agent.attachments.removeName', { name: item.name })} icon={<X size={13} />} onClick={() => onRemoveAttachment(item.client_id)} />
                    </Tooltip>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {unsupportedImages ? (
          <div className={styles['attachment-warning']} role="alert">{t('agent.attachments.imageModelUnsupported')}</div>
        ) : null}
        <Input.TextArea
          className={styles['composer-textarea']}
          variant="borderless"
          autoSize={{ minRows: 2, maxRows: 8 }}
          value={value}
          disabled={disabled && !active}
          placeholder={t(active ? 'agent.composer.steerPlaceholder' : 'agent.composer.placeholder')}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className={styles['composer-actions']}>
          <div className={styles['composer-secondary-actions']}>
            {!active ? (
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
                    disabled={disabled || attachments.length >= 8}
                    onClick={() => fileInputRef.current?.click()}
                  />
                </Tooltip>
              </>
            ) : null}
          </div>
          <div className={styles['composer-primary-actions']}>
            <AgentModelSelector
              models={models}
              selectedModelId={selectedModelId}
              fallbackName={selectedModelName}
              fallbackProviderName={selectedProviderName}
              disabled={modelSelectionDisabled}
              onChange={onModelChange}
              onOpenSettings={onOpenSettings}
            />
            {active ? (
              <Tooltip title={t('agent.composer.stop')}>
                <Button className={styles['composer-stop']} danger aria-label={t('agent.composer.stop')} icon={<Square size={12} fill="currentColor" />} disabled={disabled || runStatus === 'stopping'} onClick={onStop} />
              </Tooltip>
            ) : null}
            <Tooltip title={t(active ? 'agent.composer.steer' : 'agent.composer.send')}>
              <Button
                type="primary"
                className={styles['composer-submit']}
                aria-label={t(active ? 'agent.composer.steer' : 'agent.composer.send')}
                icon={active ? <CornerDownLeft size={15} /> : <ArrowUp size={16} />}
                disabled={blocked || !value.trim() || runStatus === 'stopping'}
                onClick={submit}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}

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
