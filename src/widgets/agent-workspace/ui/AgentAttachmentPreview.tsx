import { Alert, Modal, Spin } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAttachment } from '#entities/agent'
import { isAgentDisplayImageMIMEType } from '#common/contracts'
import { ImagePreview } from '#shared/ui'
import styles from './AgentAttachmentPreview.module.scss'

export function AgentAttachmentPreview({
  attachment,
  local,
  onClose,
  onLoad,
  onLoadLocal,
}: {
  attachment?: AgentAttachment
  local?: { file?: File; client_id?: string; name?: string; mime_type?: string; origin?: AgentAttachment['origin'] }
  onLoadLocal?: (clientId: string, signal?: AbortSignal) => Promise<Blob>
  onClose: () => void
  onLoad: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
}) {
  const { t } = useTranslation()
  const imageSource = useMemo(() => {
    if (local && !local.origin && isAgentDisplayImageMIMEType(local.file?.type ?? local.mime_type ?? '')) {
      return { id: crypto.randomUUID(), title: local.file?.name ?? local.name ?? '', load: async (signal: AbortSignal) => {
        if (local.file) return local.file
        if (local.client_id && onLoadLocal) return onLoadLocal(local.client_id, signal)
        throw new Error('AGENT_IMAGE_UNAVAILABLE')
      } }
    }
    if (!local && attachment?.kind === 'image') {
      return { id: `${attachment.id}:${attachment.revision}`, title: attachment.original_name,
        load: (signal: AbortSignal) => onLoad(attachment, signal) }
    }
    return undefined
  }, [attachment, local, onLoad, onLoadLocal])
  if (imageSource) return <ImagePreview source={imageSource} onClose={onClose} />
  if (!attachment && !local) return null
  const origin = local?.origin ?? attachment?.origin
  const title = origin ? t('agent.attachments.terminalReference', { host: origin.host_name }) : local?.file?.name ?? local?.name ?? attachment?.original_name
  return <TextAttachmentPreview key={attachment ? `${attachment.id}:${attachment.revision}` : title}
    attachment={attachment} local={local} title={title} onClose={onClose} onLoad={onLoad} onLoadLocal={onLoadLocal} />
}

function TextAttachmentPreview({ attachment, local, title, onClose, onLoad, onLoadLocal }: {
  attachment?: AgentAttachment
  local?: { file?: File; client_id?: string }
  onLoadLocal?: (clientId: string, signal?: AbortSignal) => Promise<Blob>
  title?: string
  onClose: () => void
  onLoad: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!attachment && !local) {
      setContent(undefined)
      setFailed(false)
      return undefined
    }
    const controller = new AbortController()
    setContent(undefined)
    setFailed(false)
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      if (!local) return onLoad(attachment!, controller.signal)
      if (local.file) return local.file
      if (local.client_id && onLoadLocal) return onLoadLocal(local.client_id, controller.signal)
      throw new Error('AGENT_ATTACHMENT_UNAVAILABLE')
    }).then(async (blob) => {
      if (controller.signal.aborted) return
      const text = await blob.text()
      if (!controller.signal.aborted) setContent(text)
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true)
    })
    return () => {
      controller.abort()
    }
  }, [attachment, local, onLoad, onLoadLocal])

  return (
    <Modal
      centered
      open={Boolean(attachment || local)}
      width={760}
      title={title}
      footer={null}
      destroyOnHidden
      className="termous-modal"
      onCancel={onClose}
    >
      <div className={styles.preview}>
        {failed ? <Alert type="error" showIcon title={t('agent.attachments.previewFailed')} /> : null}
        {!failed && content === undefined ? <Spin size="small" /> : null}
        {content !== undefined ? <pre>{content}</pre> : null}
      </div>
    </Modal>
  )
}
