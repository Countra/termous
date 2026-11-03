import { Button } from 'antd'
import { Play, Save, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './WorkflowEditorToolbar.module.scss'
import { WorkflowActionsMenu } from './WorkflowActionsMenu'
import { WorkflowSettingsDrawer } from './WorkflowSettingsDrawer'
import { WorkflowNameEditor } from './WorkflowNameEditor'

interface Props {
  name: string
  description: string
  tags: string[]
  revision?: number
  parameterCount: number
  dirty: boolean
  busy: boolean
  onChange: (patch: { name?: string; description?: string; tags?: string[] }) => void
  onSave: () => void
  onValidate: () => void
  onRun: (debug: boolean) => void
  onParameters: () => void
  onHistory: () => void
  onImport?: () => void
  onExport?: () => void
  exchangeBusy?: boolean
  onCopy: () => void
  onRemove: () => void
}

export function WorkflowEditorToolbar(props: Props) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState(false)
  return <>
    <header className={styles.header} data-tour="automation-editor">
      <div className={styles.identity}>
        <WorkflowNameEditor value={props.name} disabled={props.busy} onChange={name => props.onChange({ name })} />
        <div className={styles.revision}><span>{props.revision ? `v${props.revision}` : t('desktopWorkflow.draft')}</span><span className={styles['save-state']} data-dirty={props.dirty || undefined} role="status">{t(props.dirty ? 'desktopWorkflow.unsaved' : 'desktopWorkflow.saved')}</span></div>
      </div>
      <div className={styles.actions}>
        <Button icon={<Settings2 size={15} />} disabled={props.busy} aria-haspopup="dialog" aria-expanded={settings} onClick={() => setSettings(true)}>{t('desktopWorkflow.workflowSettings')}</Button>
        <WorkflowActionsMenu {...props} />
        <span className={styles.separator} />
        <Button icon={<Save size={15} />} disabled={!props.dirty || props.busy || !props.name.trim()} loading={props.busy} onClick={props.onSave}>{t('desktopWorkflow.save')}</Button>
        <Button type="primary" icon={<Play size={15} />} disabled={props.dirty || props.busy || !props.revision} onClick={() => props.onRun(false)}>{t('desktopWorkflow.run')}</Button>
      </div>
    </header>
    <WorkflowSettingsDrawer {...props} open={settings} onClose={() => setSettings(false)} />
  </>
}
