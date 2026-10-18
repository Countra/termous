import { Button, Dropdown, Tooltip } from 'antd'
import { Bug, CheckCheck, Copy, History, MoreHorizontal, Play, Save, Settings2, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './WorkflowEditorToolbar.module.scss'
import overlays from '../shared/WorkflowOverlays.module.scss'
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
  propertiesVisible: boolean
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
    <header className={styles.header} data-tour="automation-editor">
      <div className={styles.identity}>
        <WorkflowNameEditor value={props.name} disabled={props.busy} onChange={name => props.onChange({ name })} />
        <div className={styles.revision}><span>{props.revision ? `v${props.revision}` : t('desktopWorkflow.draft')}</span><span className={styles['save-state']} data-dirty={props.dirty || undefined} role="status">{t(props.dirty ? 'desktopWorkflow.unsaved' : 'desktopWorkflow.saved')}</span></div>
      </div>
      <div className={styles.actions}>
        <Button icon={<Settings2 size={15} />} disabled={props.busy} aria-haspopup="dialog" aria-expanded={settings} onClick={() => setSettings(true)}>{t('desktopWorkflow.workflowSettings')}</Button>
        <Tooltip title={t('desktopWorkflow.properties')}><Button type={props.propertiesVisible ? 'default' : 'text'} icon={<SlidersHorizontal size={16} />} disabled={props.busy} aria-label={t('desktopWorkflow.properties')} aria-expanded={props.propertiesVisible} onClick={props.onProperties} /></Tooltip>
        <Dropdown trigger={['click']} classNames={{ root: overlays.menu }} menu={{ items: [
          { key: 'validate', label: t('desktopWorkflow.validate'), icon: <CheckCheck size={15} />, disabled: props.busy, onClick: props.onValidate },
          { key: 'debug', label: t('desktopWorkflow.debug'), icon: <Bug size={15} />, disabled: props.dirty || props.busy || !props.revision, onClick: () => props.onRun(true) },
          { key: 'parameters', label: t('desktopWorkflow.parameters'), icon: <SlidersHorizontal size={15} />, disabled: props.busy, onClick: props.onParameters },
          { type: 'divider' },
          { key: 'history', label: t('desktopWorkflow.history'), icon: <History size={15} />, disabled: !props.revision || props.busy, onClick: props.onHistory },
          { key: 'copy', label: t('desktopWorkflow.copy'), icon: <Copy size={15} />, disabled: props.busy, onClick: props.onCopy },
          { key: 'delete', label: t('desktopWorkflow.delete'), icon: <Trash2 size={15} />, disabled: !props.revision || props.busy, danger: true, onClick: props.onRemove },
        ] }}><Button type="text" aria-label={t('desktopWorkflow.moreActions')} disabled={props.busy} icon={<MoreHorizontal size={17} />} /></Dropdown>
        <span className={styles.separator} />
        <Button icon={<Save size={15} />} disabled={!props.dirty || props.busy || !props.name.trim()} loading={props.busy} onClick={props.onSave}>{t('desktopWorkflow.save')}</Button>
        <Button type="primary" icon={<Play size={15} />} disabled={props.dirty || props.busy || !props.revision} onClick={() => props.onRun(false)}>{t('desktopWorkflow.run')}</Button>
      </div>
    </header>
    <WorkflowSettingsDrawer {...props} open={settings} onClose={() => setSettings(false)} />
  </>
}
