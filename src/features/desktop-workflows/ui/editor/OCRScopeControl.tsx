import { Button } from 'antd'
import { ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Region } from '#entities/desktop-workflow'
import styles from './OCRScopeControl.module.scss'

interface Props {
  region?: Region
  editing: boolean
  stale: boolean
  disabled: boolean
  canEdit: boolean
  onEdit: () => void
  onCancel: () => void
  onClear: () => void
}

export function OCRScopeControl({ region, editing, stale, disabled, canEdit, onEdit, onCancel, onClear }: Props) {
  const { t } = useTranslation()
  return <div className={styles.scope} role="group" aria-label={t('desktopWorkflow.ocr.scope')}>
    <div className={styles.summary}>
      <span>{t('desktopWorkflow.ocr.scope')}</span>
      <strong>{t(`desktopWorkflow.ocr.${region ? 'scopeRegion' : 'scopeAll'}`)}</strong>
      {region && <span className={styles.bounds}>{region.x}, {region.y} · {region.width} × {region.height}</span>}
    </div>
    <div className={styles.actions}>
      {editing
        ? <Button size="small" disabled={disabled} onClick={onCancel}>{t('desktopWorkflow.ocr.cancelScope')}</Button>
        : <Button size="small" icon={<ScanLine size={14} />} disabled={disabled || !canEdit} onClick={onEdit}>
          {t(`desktopWorkflow.ocr.${region ? 'editScope' : 'selectScope'}`)}
        </Button>}
      {region && <Button size="small" type="text" disabled={disabled} onClick={onClear}>{t('desktopWorkflow.fullScreen')}</Button>}
    </div>
    {stale && <p className={styles.warning} role="status">{t('desktopWorkflow.ocr.staleScope')}</p>}
  </div>
}
