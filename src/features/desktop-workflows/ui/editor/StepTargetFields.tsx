import { Collapse, InputNumber, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ImageTarget, Target } from '#entities/desktop-workflow'
import { blankImage } from '../../model/images'
import styles from '../shared/WorkflowForms.module.scss'

export function ImageFields({ value, change }: { value?: ImageTarget; change: (next: ImageTarget) => void }) {
  const { t } = useTranslation()
  const image = value ?? blankImage()
  return <>
    {!image.asset_id && <p className={styles['field-notice']}>{t('desktopWorkflow.templateHint')}</p>}
    <label>{t('desktopWorkflow.threshold')}<InputNumber min={.5} max={1} step={.01} value={image.threshold ?? .95} onChange={(v) => change({ ...image, threshold: v ?? .95 })} /></label>
    <label>{t('desktopWorkflow.scales')}<Select mode="multiple" maxCount={9} value={image.scales ?? [1]} options={[.5, .67, .75, .8, 1, 1.25, 1.5, 1.75, 2].map((scale) => ({ value: scale, label: `${scale}×` }))} onChange={(scales) => change({ ...image, scales })} /></label>
    <Collapse size="small" ghost items={[{ key: 'position', label: t('desktopWorkflow.positionOptions'), children: <div className={styles['field-stack']}>
      <div className={styles['field-pair']}>{(['x', 'y'] as const).map((axis) => <label key={axis}>{t('desktopWorkflow.offset', { axis: axis.toUpperCase() })}<InputNumber value={image.offset?.[axis] ?? 0} onChange={(v) => change({ ...image, offset: { ...image.offset, [axis]: v ?? 0 } })} /></label>)}</div>
      <label className={styles['switch-field']}>{t('desktopWorkflow.anchor')}<Switch checked={!!image.anchor} onChange={(enabled) => change({ ...image, anchor: enabled ? { x: 0, y: 0 } : undefined })} /></label>
      {image.anchor && <div className={styles['field-pair']}>{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<InputNumber min={0} max={511} value={image.anchor![axis]} onChange={(v) => change({ ...image, anchor: { ...image.anchor!, [axis]: v ?? 0 } })} /></label>)}</div>}
      {image.region && <p className={styles.hint}>{t('desktopWorkflow.regionSummary', { ...image.region })} <button type="button" className={styles['text-button']} onClick={() => change({ ...image, region: undefined, reference_width: undefined, reference_height: undefined })}>{t('desktopWorkflow.fullScreen')}</button></p>}
    </div> }]} />
  </>
}

export function TargetFields({ value, change }: { value?: Target; change: (next: Target) => void }) {
  const { t } = useTranslation()
  const target = value ?? { kind: 'image' as const }
  return <>
    <label>{t('desktopWorkflow.targetType')}<Select aria-label={t('desktopWorkflow.targetType')} value={target.kind} options={[{ value: 'image', label: t('desktopWorkflow.imageTarget') }, { value: 'point', label: t('desktopWorkflow.pointTarget') }]} onChange={(kind) => change(kind === 'image' ? { kind, image: blankImage() } : { kind, x: 0, y: 0 })} /></label>
    {target.kind === 'image' ? <ImageFields value={target.image} change={(image) => change({ ...target, image })} /> : <>
      <div className={styles['field-pair']}>{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<InputNumber min={0} value={target[axis] ?? 0} onChange={(v) => change({ ...target, [axis]: v ?? 0 })} /></label>)}</div>
      <div className={styles['field-pair']}>{(['reference_width', 'reference_height'] as const).map((field) => <label key={field}>{t(`desktopWorkflow.${field}`)}<InputNumber min={1} max={16384} value={target[field]} onChange={(v) => change({ ...target, [field]: v ?? undefined })} /></label>)}</div>
    </>}
  </>
}
