import { Input, InputNumber, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type { OCRQuery, OCRTarget } from '#entities/desktop-workflow'
import styles from '../shared/WorkflowForms.module.scss'

export function OCRFields({ value, change, bound = false }: { value: OCRQuery; change: (next: OCRQuery) => void; bound?: boolean }) {
  const { t } = useTranslation()
  return <div className={styles['field-stack']}>
    <label>{t('desktopWorkflow.ocr.text')}<Input.TextArea rows={2} maxLength={1024} disabled={bound} value={value.text ?? ''} onChange={e => change({ ...value, text: e.target.value })} /></label>
    <label>{t('desktopWorkflow.ocr.match')}<Select value={value.match ?? 'exact'} options={['exact', 'contains', 'regex'].map(v => ({ value:v,label:t(`desktopWorkflow.ocr.${v}`) }))} onChange={match => change({...value,match})} /></label>
    <label className={styles['switch-field']}>{t('desktopWorkflow.ocr.caseSensitive')}<Switch checked={value.case_sensitive ?? true} onChange={case_sensitive => change({...value,case_sensitive})} /></label>
    <label className={styles['switch-field']}>{t('desktopWorkflow.ocr.whitespace')}<Switch checked={value.normalize_whitespace ?? true} onChange={normalize_whitespace => change({...value,normalize_whitespace})} /></label>
    <label>{t('desktopWorkflow.ocr.confidence')}<InputNumber min={0} max={1} step={.05} value={value.text_confidence} onChange={v => { if (v !== null) change({...value,text_confidence:v}) }} /></label>
    <label>{t('desktopWorkflow.ocr.maxSide')}<InputNumber min={640} max={1920} step={32} precision={0} value={value.ocr_max_side} onChange={v => { if (v !== null) change({...value,ocr_max_side:v}) }} /></label>
    <p className={styles.hint}>{t('desktopWorkflow.ocr.fixedParameters')}</p>
    {value.region && <p className={styles.hint}>{t('desktopWorkflow.regionSummary',value.region)} <button type="button" className={styles['text-button']} onClick={() => change({...value,region:undefined,reference_width:undefined,reference_height:undefined})}>{t('desktopWorkflow.fullScreen')}</button></p>}
  </div>
}

export function OCRTargetFields({ value, change, bound }: { value: OCRTarget; change: (next: OCRTarget) => void; bound?: boolean }) {
  const { t } = useTranslation()
  return <>
    <OCRFields value={value} bound={bound} change={q => change({...value,...q})} />
    <label>{t('desktopWorkflow.ocr.occurrence')}<InputNumber min={1} max={1000} precision={0} placeholder={t('desktopWorkflow.ocr.unique')} value={value.occurrence || null} onChange={occurrence => change({...value,occurrence:occurrence ?? undefined})} /></label>
    <label>{t('desktopWorkflow.anchor')}<Select value={value.anchor ?? 'center'} options={(['top_left','top','top_right','left','center','right','bottom_left','bottom','bottom_right'] as const).map(anchor => ({value:anchor,label:t(`desktopWorkflow.ocr.anchors.${anchor}`)}))} onChange={anchor => change({...value,anchor})} /></label>
    <div className={styles['field-pair']}>{(['x','y'] as const).map(axis => <label key={axis}>{t('desktopWorkflow.offset',{axis:axis.toUpperCase()})}<InputNumber min={-16384} max={16384} precision={0} value={value.offset[axis]} onChange={v => change({...value,offset:{...value.offset,[axis]:v ?? 0}})} /></label>)}</div>
    <p className={styles.hint}>{t('desktopWorkflow.ocr.targetHint')}</p>
  </>
}
