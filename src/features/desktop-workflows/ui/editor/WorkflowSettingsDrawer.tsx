import { Button, Drawer, Input, Select } from 'antd'
import { ArrowUpRight, Copy, History, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import overlays from '../shared/WorkflowOverlays.module.scss'
import styles from './WorkflowEditorToolbar.module.scss'

interface Props {
  open: boolean; name: string; description: string; tags: string[]; revision?: number
  parameterCount: number; busy: boolean; dirty: boolean
  onClose: () => void; onSave: () => void
  onChange: (patch: { name?: string; description?: string; tags?: string[] }) => void
  onParameters: () => void; onHistory: () => void; onCopy: () => void; onRemove: () => void
}

export function WorkflowSettingsDrawer(props: Props) {
  const { t } = useTranslation()
  const navigate = (action: () => void) => { props.onClose(); action() }
  return <Drawer open={props.open} title={t('desktopWorkflow.workflowSettings')} onClose={props.onClose} size={384}
    classNames={{ section: overlays.drawer, header: overlays['overlay-header'], body: overlays['drawer-body'] }}
    footer={<div className={styles['settings-footer']}><span data-dirty={props.dirty || undefined}>{t(props.dirty ? 'desktopWorkflow.unsaved' : 'desktopWorkflow.saved')}</span><Button type="primary" icon={<Save size={14} />} loading={props.busy} disabled={!props.dirty || props.busy || !props.name.trim()} onClick={props.onSave}>{t('desktopWorkflow.save')}</Button></div>}>
    <div className={styles.settings}>
      <section className={styles['settings-section']}>
        <h4>{t('desktopWorkflow.settingsBasics')}</h4>
        <label>{t('desktopWorkflow.scriptName')}<Input maxLength={120} value={props.name} disabled={props.busy} onChange={(event) => props.onChange({ name: event.target.value })} /></label>
        <label>{t('desktopWorkflow.description')}<Input.TextArea rows={3} value={props.description} maxLength={1000} disabled={props.busy} onChange={(event) => props.onChange({ description: event.target.value })} /></label>
        <label>{t('desktopWorkflow.tags')}<Select mode="tags" maxCount={16} value={props.tags} disabled={props.busy} placeholder={t('desktopWorkflow.tags')} onChange={(tags) => props.onChange({ tags })} /></label>
      </section>
      <section className={styles['settings-section']}>
        <h4>{t('desktopWorkflow.settingsConfiguration')}</h4>
        <button type="button" className={styles['settings-link']} disabled={props.busy} onClick={() => navigate(props.onParameters)}>
          <SlidersHorizontal size={17} /><span><strong>{t('desktopWorkflow.parameters')}</strong><small>{t('desktopWorkflow.parameterCount', { count: props.parameterCount })}</small></span><ArrowUpRight size={15} />
        </button>
        <button type="button" className={styles['settings-link']} disabled={!props.revision || props.busy} onClick={() => navigate(props.onHistory)}>
          <History size={17} /><span><strong>{t('desktopWorkflow.history')}</strong><small>{props.revision ? t('desktopWorkflow.currentVersion', { version: props.revision }) : t('desktopWorkflow.saveForHistory')}</small></span><ArrowUpRight size={15} />
        </button>
      </section>
      <section className={styles['settings-section']}>
        <h4>{t('desktopWorkflow.settingsManagement')}</h4>
        <div className={styles.management}>
          <Button icon={<Copy size={15} />} disabled={props.busy} onClick={() => navigate(props.onCopy)}>{t('desktopWorkflow.copy')}</Button>
          <Button icon={<Trash2 size={15} />} danger disabled={!props.revision || props.busy} onClick={() => navigate(props.onRemove)}>{t('desktopWorkflow.delete')}</Button>
        </div>
      </section>
    </div>
  </Drawer>
}
