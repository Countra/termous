import { ZoomIn } from 'lucide-react'
import { useMemo } from 'react'
import { ImageThumbnail, type ImagePreviewSource } from '#shared/ui'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import styles from './ExecutionImageCard.module.scss'

export function ExecutionImageCard({ assetID, title, actionLabel, gateway, onImage }: {
  assetID: string; title: string; actionLabel: string
  gateway: Pick<WorkflowMediaGateway, 'asset'>; onImage: (source: ImagePreviewSource) => void
}) {
  // 报告刷新、展开预览都不改变资源身份，避免缩略图反复释放和读取。
  const source = useMemo(() => ({ kind: 'remote' as const, key: assetID,
    load: (signal?: AbortSignal) => gateway.asset(assetID, signal),
  }), [assetID, gateway])
  return <button type="button" className={styles.card} aria-label={actionLabel}
    onClick={() => onImage({ id: assetID, title, load: source.load })}>
    <ImageThumbnail className={styles.thumbnail} source={source} alt={title} />
    <span className={styles.label}><strong>{title}</strong><span>{actionLabel}</span></span>
    <ZoomIn size={15} aria-hidden="true" />
  </button>
}
