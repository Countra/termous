import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePreview, ImageThumbnail } from '#shared/ui'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import styles from './ScreenshotEditor.module.scss'

export function ScreenshotTemplatePreview({ assetID, gateway }: { assetID: string; gateway: WorkflowMediaGateway }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // 缩略图的读取函数以资源为生命周期，避免框选或草稿更新时反复取消、重载。
  const source = useMemo(() => ({ kind: 'remote' as const, key: assetID, load: (signal?: AbortSignal) => gateway.asset(assetID, signal) }), [assetID, gateway])
  return <>
    <button type="button" className={styles['template-button']} aria-label={t('desktopWorkflow.previewTemplate')} onClick={() => setOpen(true)}>
      <ImageThumbnail source={source} alt={t('desktopWorkflow.template')} />
    </button>
    <ImagePreview source={open ? { id: assetID, title: t('desktopWorkflow.template'), load: source.load } : undefined} onClose={() => setOpen(false)} />
  </>
}
