import { Maximize2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePreview, ImageThumbnail } from '#shared/ui'
import { loadAgentImage } from '../model/agentImageResources.ts'
import type { AgentImageLoader, AgentWorkspaceImage } from '../model/types.ts'
import styles from './AgentImage.module.scss'

export function AgentImage({ image, title, onLoad }: { image: AgentWorkspaceImage; title: string; onLoad?: AgentImageLoader }) {
  const { t } = useTranslation()
  const [previewOpen, setPreviewOpen] = useState(false)
  const { id, reference, session_id, message_id, part_id, content_index, revision, mime_type, size_bytes } = image
  const load = useCallback((signal?: AbortSignal) => loadAgentImage({
    id, reference, session_id, message_id, part_id, content_index, revision, mime_type, size_bytes,
  }, onLoad, signal), [id, reference, session_id, message_id, part_id, content_index, revision, mime_type, size_bytes, onLoad])
  return (
    <span className={styles.image}>
      <button type="button" className={styles.card}
        aria-label={t('agent.attachments.previewName', { name: title })}
        onClick={() => setPreviewOpen(true)}
      >
        <ImageThumbnail className={styles.media} source={{ kind: 'remote', key: image.id, load }} alt={title}
          failureLabel={t('imagePreview.failed')} />
        <span className={styles.caption}>
          <span className={styles.title}>{title}</span>
          <span className={styles.action}><Maximize2 size={12} aria-hidden="true" />{t('agent.images.expand')}</span>
        </span>
      </button>
      <ImagePreview source={previewOpen ? { id: image.id, title, load } : undefined} onClose={() => setPreviewOpen(false)} />
    </span>
  )
}
