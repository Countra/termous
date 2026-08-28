import { Alert, Modal, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAttachment } from '#entities/agent'
import styles from './AgentAttachmentPreview.module.scss'

export function AgentAttachmentPreview({
  attachment,
  onClose,
  onLoad,
}: {
  attachment?: AgentAttachment
  onClose: () => void
  onLoad: (attachment: AgentAttachment, signal?: AbortSignal) => Promise<Blob>
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState<{ text?: string; imageUrl?: string }>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!attachment) {
      setContent(undefined)
      setFailed(false)
      return undefined
    }
    const controller = new AbortController()
    let imageUrl: string | undefined
    setContent(undefined)
    setFailed(false)
    void onLoad(attachment, controller.signal).then(async (blob) => {
      if (controller.signal.aborted) return
      if (attachment.kind === 'image') {
        imageUrl = URL.createObjectURL(blob)
        setContent({ imageUrl })
        return
      }
      const text = await blob.text()
      if (!controller.signal.aborted) setContent({ text })
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true)
    })
    return () => {
      controller.abort()
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [attachment, onLoad])

  return (
    <Modal
      centered
      open={Boolean(attachment)}
      width={760}
      title={attachment?.original_name}
      footer={null}
      destroyOnHidden
      className="termous-modal"
      onCancel={onClose}
    >
      <div className={styles.preview}>
        {failed ? <Alert type="error" showIcon title={t('agent.attachments.previewFailed')} /> : null}
        {!failed && !content ? <Spin size="small" /> : null}
        {content?.imageUrl ? <img src={content.imageUrl} alt={attachment?.original_name ?? ''} /> : null}
        {content?.text !== undefined ? <pre>{content.text}</pre> : null}
      </div>
    </Modal>
  )
}
