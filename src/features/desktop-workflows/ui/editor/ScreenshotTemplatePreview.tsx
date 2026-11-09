import { useCallback, useState } from 'react'
import { Button, Tooltip } from 'antd'
import { Image } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ImagePreview } from '#shared/ui'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

export function ScreenshotTemplatePreview({ assetID, gateway }: { assetID: string; gateway: WorkflowMediaGateway }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // 读取函数以资源为生命周期，仅打开预览时加载模板图片。
  const load = useCallback((signal: AbortSignal) => gateway.asset(assetID, signal), [assetID, gateway])
  return <>
    <Tooltip title={t('desktopWorkflow.previewTemplate')}><Button type="text" size="small" icon={<Image size={15} />} aria-label={t('desktopWorkflow.previewTemplate')} onClick={() => setOpen(true)} /></Tooltip>
    <ImagePreview source={open ? { id: assetID, title: t('desktopWorkflow.template'), load } : undefined} onClose={() => setOpen(false)} />
  </>
}
