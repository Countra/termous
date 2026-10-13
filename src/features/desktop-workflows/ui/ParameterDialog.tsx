import { Button, Input, InputNumber, Modal, Select, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Parameter } from '#entities/desktop-workflow'
import styles from './WorkflowWorkspace.module.scss'

export function ParameterDialog({ value, onSave, onClose }: { value: Parameter[]; onSave: (parameters: Parameter[]) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [parameters, setParameters] = useState(() => structuredClone(value))
  const change = (index: number, patch: Partial<Parameter>) => setParameters((items) => items.map((p, i) => i === index ? { ...p, ...patch } : p))
  return <Modal open title={t('desktopWorkflow.parameters')} onCancel={onClose} onOk={() => { onSave(parameters); onClose() }} width={640}>
    <p className={styles.hint}>{t('desktopWorkflow.parameterHint')}</p>
    {parameters.map((p, i) => <div key={p.id} className={styles['parameter-row']}>
      <Input aria-label={t('desktopWorkflow.parameterName')} placeholder={t('desktopWorkflow.parameterName')} value={p.name} maxLength={80} onChange={(event) => change(i, { name: event.target.value })} />
      <Select aria-label={t('desktopWorkflow.parameterType')} value={p.type} options={['string', 'number', 'boolean'].map((type) => ({ value: type, label: t(`desktopWorkflow.types.${type}`) }))} onChange={(type) => change(i, { type, sensitive: false, default: undefined })} />
      <label>{t('desktopWorkflow.sensitive')}<Switch size="small" disabled={p.type !== 'string'} checked={p.sensitive} onChange={(sensitive) => change(i, { sensitive, default: undefined })} /></label>
      {!p.sensitive && <label>{t('desktopWorkflow.defaultValue')}{p.type === 'boolean' ? <Switch checked={p.default === true} onChange={(v) => change(i, { default: v })} /> : p.type === 'number' ? <InputNumber precision={0} min={-2147483647} max={2147483647} value={typeof p.default === 'number' ? p.default : undefined} onChange={(v) => change(i, { default: v ?? undefined })} /> : <Input value={typeof p.default === 'string' ? p.default : ''} onChange={(event) => change(i, { default: event.target.value })} />}</label>}
      <Button danger type="text" onClick={() => setParameters((items) => items.filter((_, index) => index !== i))}>{t('desktopWorkflow.delete')}</Button>
    </div>)}
    <Button disabled={parameters.length >= 64} onClick={() => setParameters((items) => [...items, { id: crypto.randomUUID(), name: '', type: 'string' }])}>{t('desktopWorkflow.addParameter')}</Button>
  </Modal>
}
