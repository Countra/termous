import { Button, Select, Tooltip } from 'antd'
import { Redo2, Trash2, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './ScreenshotCanvas.module.scss'

interface Props {
  zoom: number | 'fit'; scale: number; ready: boolean
  onZoom: (zoom: number | 'fit') => void
  selectionMode: boolean; disabled: boolean; canUndo: boolean; canRedo: boolean; hasSelection: boolean
  onEdit: (action: 'undo' | 'redo' | 'delete') => void
}

export function ScreenshotCanvasToolbar({ zoom, scale, ready, onZoom, selectionMode, disabled, canUndo, canRedo, hasSelection, onEdit }: Props) {
  const { t } = useTranslation()
  const levels = [.5, 1, 2, 4]
  if (zoom !== 'fit' && !levels.includes(scale)) levels.push(scale)
  return <div className={styles['view-tools']} role="toolbar" aria-label={t('desktopWorkflow.previewTools.title')}>
    <Select className={styles.zoom} size="small" aria-label={t('desktopWorkflow.zoom')} disabled={!ready} value={zoom === 'fit' ? 'fit' : String(scale)}
      options={[{ value: 'fit', label: t('desktopWorkflow.fit') }, ...levels.sort((a, b) => a - b).map(value => ({ value: String(value), label: `${Math.round(value * 100)}%` }))]}
      onChange={value => onZoom(value === 'fit' ? value : Number(value))} />
    <Tooltip title={t('desktopWorkflow.previewTools.hint')}><span className={styles['view-hint']}>{t('desktopWorkflow.previewTools.wheel')}</span></Tooltip>
    {selectionMode && <div className={styles['history-actions']}>
      <Tooltip title={t('desktopWorkflow.selection.undoHint')}><Button type="text" size="small" icon={<Undo2 size={14} />} aria-label={t('desktopWorkflow.selection.undo')} disabled={disabled || !canUndo} onClick={() => onEdit('undo')} /></Tooltip>
      <Tooltip title={t('desktopWorkflow.selection.redoHint')}><Button type="text" size="small" icon={<Redo2 size={14} />} aria-label={t('desktopWorkflow.selection.redo')} disabled={disabled || !canRedo} onClick={() => onEdit('redo')} /></Tooltip>
      <Tooltip title={t('desktopWorkflow.selection.deleteHint')}><Button type="text" size="small" icon={<Trash2 size={14} />} aria-label={t('desktopWorkflow.selection.delete')} disabled={disabled || !hasSelection} onClick={() => onEdit('delete')} /></Tooltip>
    </div>}
  </div>
}
