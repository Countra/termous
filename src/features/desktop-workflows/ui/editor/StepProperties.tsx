import { Collapse, Input, InputNumber, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Action, Parameter, Step } from '#entities/desktop-workflow'
import styles from '../shared/WorkflowForms.module.scss'

import { setStepTarget } from '../../model/images'
import { ImageFields, TargetFields } from './StepTargetFields'
import { stepIcons, stepLabel } from '../shared/stepPresentation'

const keyCodes = ['ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft', 'Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`), ...Array.from({ length: 10 }, (_, i) => `Digit${i}`), ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]
export function StepProperties({ step, parameters, onChange }: { step: Step; parameters: Parameter[]; onChange: (step: Step) => void }) {
  const { t } = useTranslation()
  const changeAction = (patch: Partial<Action>) => onChange({ ...step, action: { ...step.action, ...patch } })
  const bindingFields = step.kind === 'keyboard.text' || step.kind === 'clipboard.set_text' ? ['text'] : step.kind === 'keyboard.key' ? ['code'] : step.kind === 'resize' ? ['width', 'height'] : step.kind === 'delay' ? ['delay_ms'] : step.kind === 'repeat' ? ['iterations'] : step.kind.startsWith('pointer.') ? [...(step.target?.kind === 'point' ? ['x', 'y'] : []), ...(step.kind === 'pointer.click' ? ['count'] : step.kind === 'pointer.scroll' ? ['delta', 'horizontal'] : step.kind === 'pointer.drag' ? ['duration_ms'] : [])] : []
  const numeric = (field: 'count' | 'delta' | 'duration_ms' | 'width' | 'height', min: number, max: number) => <label>{t(`desktopWorkflow.${field}`)}<InputNumber min={min} max={max} value={step.action[field] ?? (field === 'delta' ? 120 : field === 'count' ? 1 : 0)} onChange={(value) => changeAction({ [field]: value ?? 0 })} /></label>
  const Icon = stepIcons[step.kind]
  return <div className={styles.properties}>
    <div className={styles['kind-heading']}><Icon size={18} /><strong>{stepLabel(step.kind, t)}</strong></div>
    <label>{t('desktopWorkflow.stepName')}<Input value={step.name} maxLength={160} placeholder={t(`desktopWorkflow.kinds.${step.kind.replace(/\./g, '_')}`)} onChange={(e) => onChange({ ...step, name: e.target.value })} /></label>
    {step.kind.startsWith('pointer.') && <><h4>{t('desktopWorkflow.target')}</h4><TargetFields value={step.target} change={(target) => onChange(setStepTarget(step, 'target', target))} /></>}
    {step.kind === 'pointer.drag' && <><h4>{t('desktopWorkflow.endTarget')}</h4><TargetFields value={step.end_target} change={(end_target) => onChange({ ...step, end_target })} />{numeric('duration_ms', 0, 2000)}</>}
    {(step.kind === 'pointer.click' || step.kind === 'pointer.drag') && <label>{t('desktopWorkflow.button')}<Select value={step.action.button ?? 'left'} options={['left', 'right', 'middle'].map((value) => ({ value, label: t(`desktopWorkflow.${value}`) }))} onChange={(button) => changeAction({ button })} /></label>}
    {step.kind === 'pointer.click' && numeric('count', 1, 2)}
    {step.kind === 'pointer.scroll' && <>{numeric('delta', -1200, 1200)}<label className={styles['switch-field']}>{t('desktopWorkflow.horizontal')}<Switch checked={step.action.horizontal} onChange={(horizontal) => changeAction({ horizontal })} /></label></>}
    {step.kind === 'keyboard.key' && <label>{t('desktopWorkflow.key')}<Select showSearch value={step.action.code} options={keyCodes.map((value) => ({ value, label: value }))} onChange={(code) => changeAction({ code })} /></label>}
    {step.kind === 'keyboard.shortcut' && <label>{t('desktopWorkflow.shortcut')}<Select mode="multiple" maxCount={8} value={step.action.codes ?? []} options={keyCodes.map((value) => ({ value, label: value }))} onChange={(codes) => changeAction({ codes })} /></label>}
    {(step.kind === 'keyboard.text' || step.kind === 'clipboard.set_text') && <label>{t('desktopWorkflow.text')}<Input.TextArea disabled={!!step.bindings?.text} rows={5} maxLength={16000} value={step.action.text ?? ''} onChange={(e) => changeAction({ text: e.target.value })} /></label>}
    {step.kind === 'resize' && <>{numeric('width', 320, 8192)}{numeric('height', 200, 8192)}</>}
    {step.kind === 'delay' && <label>{t('desktopWorkflow.delay')}<InputNumber min={0} max={120000} value={step.delay_ms ?? 0} onChange={(delay_ms) => onChange({ ...step, delay_ms: delay_ms ?? 0 })} /></label>}
    {step.kind === 'repeat' && <label>{t('desktopWorkflow.iterations')}<InputNumber min={1} max={100} value={step.iterations ?? 2} onChange={(iterations) => onChange({ ...step, iterations: iterations ?? 1 })} /></label>}
    {(step.kind.startsWith('image.') || step.kind === 'if') && <><h4>{t('desktopWorkflow.condition')}</h4><Select value={step.absent ? 'absent' : 'present'} options={['present', 'absent'].map((value) => ({ value, label: t(`desktopWorkflow.${value}`) }))} onChange={(value) => onChange({ ...step, absent: value === 'absent' })} /><ImageFields value={step.image} change={(image) => onChange({ ...step, image })} /></>}
    {(step.kind === 'image.wait' || step.kind.startsWith('pointer.')) && <label>{t('desktopWorkflow.timeout')}<InputNumber min={500} max={120000} step={500} value={step.timeout_ms || 10000} onChange={(timeout_ms) => onChange({ ...step, timeout_ms: timeout_ms ?? 10000 })} /></label>}
    {parameters.length > 0 && bindingFields.length > 0 && <Collapse size="small" items={[{ key: 'bindings', label: t('desktopWorkflow.bindings'), children: <div className={styles.properties}>{bindingFields.map((field) => <label key={field}>{t(`desktopWorkflow.fields.${field}`)}<Select allowClear value={step.bindings?.[field]} options={parameters.filter((p) => p.type === (field === 'text' || field === 'code' ? 'string' : field === 'horizontal' ? 'boolean' : 'number')).map((p) => ({ value: p.id, label: p.name || p.id }))} onChange={(id: string | undefined) => { const bindings = { ...step.bindings }; if (id) bindings[field] = id; else delete bindings[field]; onChange({ ...step, bindings, action: field === 'text' && id ? { ...step.action, text: undefined } : step.action }) }} /></label>)}</div> }]} />}
  </div>
}
