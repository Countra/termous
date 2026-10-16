import { Button, Drawer, Input, Select, Tag } from 'antd'
import { Bug, CheckCheck, Copy, History, Play, Save, Settings2, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './WorkflowEditorToolbar.module.scss'

interface Props {
  name: string
  description: string
  tags: string[]
  revision?: number
  dirty: boolean
  busy: boolean
  narrow: boolean
  hasStep: boolean
  onChange: (patch: { name?: string; description?: string; tags?: string[] }) => void
  onSave: () => void
  onValidate: () => void
  onRun: (debug: boolean) => void
  onProperties: () => void
  onParameters: () => void
  onHistory: () => void
  onCopy: () => void
  onRemove: () => void
}

export function WorkflowEditorToolbar(props: Props) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState(false)
  return <>
    <header className={styles.header}>
      <div className={styles.identity}>
        <Input className={styles.name} aria-label={t('desktopWorkflow.scriptName')} maxLength={120} value={props.name} disabled={props.busy} onChange={(event) => props.onChange({ name: event.target.value })} />
        <div className={styles.revision}><Tag variant="filled">{props.revision ? `v${props.revision}` : t('desktopWorkflow.draft')}</Tag><span className={styles['save-state']} data-dirty={props.dirty || undefined} role="status">{t(props.dirty ? 'desktopWorkflow.unsaved' : 'desktopWorkflow.saved')}</span></div>
      </div>
      <div className={styles.actions}>
        <Button icon={<Settings2 size={15} />} aria-label={t('desktopWorkflow.workflowSettings')} onClick={() => setSettings(true)}>{t('desktopWorkflow.workflowSettings')}</Button>
        <Button icon={<CheckCheck size={15} />} disabled={props.busy} onClick={props.onValidate}>{t('desktopWorkflow.validate')}</Button>
        <Button icon={<Save size={15} />} disabled={!props.dirty || props.busy || !props.name.trim()} loading={props.busy} onClick={props.onSave}>{t('desktopWorkflow.save')}</Button>
        <span className={styles.separator} />
        <Button icon={<Bug size={15} />} disabled={props.dirty || props.busy || !props.revision} onClick={() => props.onRun(true)}>{t('desktopWorkflow.debug')}</Button>
        <Button type="primary" icon={<Play size={15} />} disabled={props.dirty || props.busy || !props.revision} onClick={() => props.onRun(false)}>{t('desktopWorkflow.run')}</Button>
        {props.narrow && <Button icon={<SlidersHorizontal size={15} />} disabled={!props.hasStep} onClick={props.onProperties}>{t('desktopWorkflow.properties')}</Button>}
      </div>
    </header>
    <Drawer open={settings} title={t('desktopWorkflow.workflowSettings')} onClose={() => setSettings(false)} size={380}>
      <div className={styles.settings}>
        <label>{t('desktopWorkflow.description')}<Input.TextArea rows={4} value={props.description} maxLength={1000} disabled={props.busy} onChange={(event) => props.onChange({ description: event.target.value })} /></label>
        <label>{t('desktopWorkflow.tags')}<Select mode="tags" maxCount={16} value={props.tags} disabled={props.busy} placeholder={t('desktopWorkflow.tags')} onChange={(tags) => props.onChange({ tags })} /></label>
        <Button icon={<SlidersHorizontal size={15} />} disabled={props.busy} onClick={props.onParameters}>{t('desktopWorkflow.parameters')}</Button>
        <div className={styles.management}>
          <Button icon={<History size={15} />} disabled={!props.revision || props.busy} onClick={props.onHistory}>{t('desktopWorkflow.history')}</Button>
          <Button icon={<Copy size={15} />} disabled={props.busy} onClick={() => { setSettings(false); props.onCopy() }}>{t('desktopWorkflow.copy')}</Button>
          <Button icon={<Trash2 size={15} />} danger disabled={!props.revision || props.busy} onClick={() => { setSettings(false); props.onRemove() }}>{t('desktopWorkflow.delete')}</Button>
        </div>
      </div>
    </Drawer>
  </>
}
