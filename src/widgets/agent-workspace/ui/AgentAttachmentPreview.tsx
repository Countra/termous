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
}: {
  attachment?: AgentAttachment
  local?: { file: File; origin?: AgentAttachment['origin'] }
  onClose: () => void
  onLoad: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
}) {
  const { t } = useTranslation()
  const imageSource = useMemo(() => {
    if (local && !local.origin && isAgentDisplayImageMIMEType(local.file.type)) {
      return { id: crypto.randomUUID(), title: local.file.name, load: async () => local.file }
    }
    if (!local && attachment?.kind === 'image') {
      return { id: `${attachment.id}:${attachment.revision}`, title: attachment.original_name,
        load: (signal: AbortSignal) => onLoad(attachment, signal) }
    }
    return undefined
  }, [attachment, local, onLoad])
  if (imageSource) return <ImagePreview source={imageSource} onClose={onClose} />
  if (!attachment && !local) return null
  const origin = local?.origin ?? attachment?.origin
  const title = origin ? t('agent.attachments.terminalReference', { host: origin.host_name }) : local?.file.name ?? attachment?.original_name
  return <TextAttachmentPreview key={attachment ? `${attachment.id}:${attachment.revision}` : title}
    attachment={attachment} local={local} title={title} onClose={onClose} onLoad={onLoad} />
}

function TextAttachmentPreview({ attachment, local, title, onClose, onLoad }: {
  attachment?: AgentAttachment
  local?: { file: File }
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
      return local ? local.file : onLoad(attachment!, controller.signal)
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
  }, [attachment, local, onLoad])

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
