import { Collapse, Input, InputNumber, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Action, ImageTarget, Parameter, Step, Target } from '#entities/desktop-workflow'
import styles from './WorkflowWorkspace.module.scss'

import { blankImage, setStepTarget } from '../model/images'

function ImageFields({ value, change }: { value?: ImageTarget; change: (next: ImageTarget) => void }) {
  const { t } = useTranslation(); const image = value ?? blankImage()
  return <>
    <label>{t('desktopWorkflow.threshold')}<InputNumber min={.5} max={1} step={.01} value={image.threshold ?? .95} onChange={(v) => change({ ...image, threshold: v ?? .95 })} /></label>
    <label>{t('desktopWorkflow.scales')}<Select mode="multiple" maxCount={9} value={image.scales ?? [1]} options={[.5, .67, .75, .8, 1, 1.25, 1.5, 1.75, 2].map((scale) => ({ value: scale, label: `${scale}×` }))} onChange={(scales) => change({ ...image, scales })} /></label>
    <div className={styles['field-pair']}>{(['x', 'y'] as const).map((axis) => <label key={axis}>{t('desktopWorkflow.offset', { axis: axis.toUpperCase() })}<InputNumber value={image.offset?.[axis] ?? 0} onChange={(v) => change({ ...image, offset: { ...image.offset, [axis]: v ?? 0 } })} /></label>)}</div>
    <label>{t('desktopWorkflow.anchor')}<Switch checked={!!image.anchor} onChange={(enabled) => change({ ...image, anchor: enabled ? { x: 0, y: 0 } : undefined })} /></label>
    {image.anchor && <div className={styles['field-pair']}>{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<InputNumber min={0} max={511} value={image.anchor![axis]} onChange={(v) => change({ ...image, anchor: { ...image.anchor!, [axis]: v ?? 0 } })} /></label>)}</div>}
    {image.region && <p className={styles.hint}>{t('desktopWorkflow.regionSummary', { ...image.region })} <button type="button" className={styles['text-button']} onClick={() => change({ ...image, region: undefined, reference_width: undefined, reference_height: undefined })}>{t('desktopWorkflow.fullScreen')}</button></p>}
  </>
}

function TargetFields({ value, change }: { value?: Target; change: (next: Target) => void }) {
  const { t } = useTranslation(); const target = value ?? { kind: 'image' as const }
  return <>
    <Select aria-label={t('desktopWorkflow.targetType')} value={target.kind} options={[{ value: 'image', label: t('desktopWorkflow.imageTarget') }, { value: 'point', label: t('desktopWorkflow.pointTarget') }]} onChange={(kind) => change(kind === 'image' ? { kind, image: blankImage() } : { kind, x: 0, y: 0 })} />
    {target.kind === 'image' ? <ImageFields value={target.image} change={(image) => change({ ...target, image })} /> : <>
      <div className={styles['field-pair']}>{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<InputNumber min={0} value={target[axis] ?? 0} onChange={(v) => change({ ...target, [axis]: v ?? 0 })} /></label>)}</div>
      <div className={styles['field-pair']}>{(['reference_width', 'reference_height'] as const).map((field) => <label key={field}>{t(`desktopWorkflow.${field}`)}<InputNumber min={1} max={16384} value={target[field]} onChange={(v) => change({ ...target, [field]: v ?? undefined })} /></label>)}</div>
    </>}
  </>
}

const keyCodes = ['ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft', 'Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`), ...Array.from({ length: 10 }, (_, i) => `Digit${i}`), ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]
export function StepProperties({ step, parameters, onChange }: { step: Step; parameters: Parameter[]; onChange: (step: Step) => void }) {
  const { t } = useTranslation()
  const changeAction = (patch: Partial<Action>) => onChange({ ...step, action: { ...step.action, ...patch } })
  const bindingFields = step.kind === 'keyboard.text' || step.kind === 'clipboard.set_text' ? ['text'] : step.kind === 'keyboard.key' ? ['code'] : step.kind === 'resize' ? ['width', 'height'] : step.kind === 'delay' ? ['delay_ms'] : step.kind === 'repeat' ? ['iterations'] : step.kind.startsWith('pointer.') ? [...(step.target?.kind === 'point' ? ['x', 'y'] : []), ...(step.kind === 'pointer.click' ? ['count'] : step.kind === 'pointer.scroll' ? ['delta', 'horizontal'] : step.kind === 'pointer.drag' ? ['duration_ms'] : [])] : []
  const numeric = (field: 'count' | 'delta' | 'duration_ms' | 'width' | 'height', min: number, max: number) => <label>{t(`desktopWorkflow.${field}`)}<InputNumber min={min} max={max} value={step.action[field] ?? (field === 'delta' ? 120 : field === 'count' ? 1 : 0)} onChange={(value) => changeAction({ [field]: value ?? 0 })} /></label>
  return <div className={styles.properties}>
    <label>{t('desktopWorkflow.stepName')}<Input value={step.name} maxLength={160} placeholder={t(`desktopWorkflow.kinds.${step.kind.replace(/\./g, '_')}`)} onChange={(e) => onChange({ ...step, name: e.target.value })} /></label>
    {step.kind.startsWith('pointer.') && <><h4>{t('desktopWorkflow.target')}</h4><TargetFields value={step.target} change={(target) => onChange(setStepTarget(step, 'target', target))} /></>}
    {step.kind === 'pointer.drag' && <><h4>{t('desktopWorkflow.endTarget')}</h4><TargetFields value={step.end_target} change={(end_target) => onChange({ ...step, end_target })} />{numeric('duration_ms', 0, 2000)}</>}
    {(step.kind === 'pointer.click' || step.kind === 'pointer.drag') && <label>{t('desktopWorkflow.button')}<Select value={step.action.button ?? 'left'} options={['left', 'right', 'middle'].map((value) => ({ value, label: t(`desktopWorkflow.${value}`) }))} onChange={(button) => changeAction({ button })} /></label>}
    {step.kind === 'pointer.click' && numeric('count', 1, 2)}
    {step.kind === 'pointer.scroll' && <>{numeric('delta', -1200, 1200)}<label>{t('desktopWorkflow.horizontal')}<Switch checked={step.action.horizontal} onChange={(horizontal) => changeAction({ horizontal })} /></label></>}
    {step.kind === 'keyboard.key' && <label>{t('desktopWorkflow.key')}<Select showSearch value={step.action.code} options={keyCodes.map((value) => ({ value, label: value }))} onChange={(code) => changeAction({ code })} /></label>}
    {step.kind === 'keyboard.shortcut' && <label>{t('desktopWorkflow.shortcut')}<Select mode="multiple" maxCount={8} value={step.action.codes ?? []} options={keyCodes.map((value) => ({ value, label: value }))} onChange={(codes) => changeAction({ codes })} /></label>}
    {(step.kind === 'keyboard.text' || step.kind === 'clipboard.set_text') && <label>{t('desktopWorkflow.text')}<Input.TextArea disabled={!!step.bindings?.text} rows={5} maxLength={16000} value={step.action.text ?? ''} onChange={(e) => changeAction({ text: e.target.value })} /></label>}
    {step.kind === 'resize' && <>{numeric('width', 320, 8192)}{numeric('height', 200, 8192)}</>}
    {step.kind === 'delay' && <label>{t('desktopWorkflow.delay')}<InputNumber min={0} max={120000} value={step.delay_ms ?? 0} onChange={(delay_ms) => onChange({ ...step, delay_ms: delay_ms ?? 0 })} /></label>}
    {step.kind === 'repeat' && <label>{t('desktopWorkflow.iterations')}<InputNumber min={1} max={100} value={step.iterations ?? 2} onChange={(iterations) => onChange({ ...step, iterations: iterations ?? 1 })} /></label>}
    {(step.kind.startsWith('image.') || step.kind === 'if') && <><h4>{t('desktopWorkflow.condition')}</h4><Select value={step.absent ? 'absent' : 'present'} options={['present', 'absent'].map((value) => ({ value, label: t(`desktopWorkflow.${value}`) }))} onChange={(value) => onChange({ ...step, absent: value === 'absent' })} /><ImageFields value={step.image} change={(image) => onChange({ ...step, image })} /></>}
    {(step.kind === 'image.wait' || step.kind.startsWith('pointer.')) && <label>{t('desktopWorkflow.timeout')}<InputNumber min={500} max={120000} step={500} value={step.timeout_ms || 10000} onChange={(timeout_ms) => onChange({ ...step, timeout_ms: timeout_ms ?? 10000 })} /></label>}
    {parameters.length > 0 && <Collapse size="small" items={[{ key: 'bindings', label: t('desktopWorkflow.bindings'), children: <div className={styles.properties}>{bindingFields.map((field) => <label key={field}>{t(`desktopWorkflow.fields.${field}`)}<Select allowClear value={step.bindings?.[field]} options={parameters.filter((p) => p.type === (field === 'text' || field === 'code' ? 'string' : field === 'horizontal' ? 'boolean' : 'number')).map((p) => ({ value: p.id, label: p.name || p.id }))} onChange={(id: string | undefined) => { const bindings = { ...step.bindings }; if (id) bindings[field] = id; else delete bindings[field]; onChange({ ...step, bindings, action: field === 'text' && id ? { ...step.action, text: undefined } : step.action }) }} /></label>)}</div> }]} />}
  </div>
}
