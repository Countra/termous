import { Button, Dropdown } from 'antd'
import { Bug, CheckCheck, ChevronDown, Copy, FileInput, FileOutput, History, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import overlays from '../shared/WorkflowOverlays.module.scss'
import styles from './WorkflowActionsMenu.module.scss'

interface Props {
  revision?: number; dirty: boolean; busy: boolean; exchangeBusy?: boolean
  onValidate: () => void; onRun: (debug: boolean) => void; onParameters: () => void
  onHistory: () => void; onImport?: () => void; onExport?: () => void
  onCopy: () => void; onRemove: () => void
}

export function WorkflowActionsMenu(props: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const label = (title: string, hint: string) => <span className={styles.label}><span>{t(title)}</span><small>{t(hint)}</small></span>
  return <Dropdown trigger={['click']} placement="bottomRight" autoFocus open={open} onOpenChange={setOpen} classNames={{ root: `${overlays.menu} ${styles.menu}` }}
    menu={{ items: [
      { type: 'group', label: t('desktopWorkflow.actionMenu.inspect'), children: [
        { key: 'validate', label: label('desktopWorkflow.validate', 'desktopWorkflow.actionMenu.validateHint'), icon: <CheckCheck size={17} />, disabled: props.busy, onClick: props.onValidate },
        { key: 'debug', label: label('desktopWorkflow.debug', 'desktopWorkflow.actionMenu.debugHint'), icon: <Bug size={17} />, disabled: props.dirty || props.busy || !props.revision, onClick: () => props.onRun(true) },
        { key: 'parameters', label: label('desktopWorkflow.parameters', 'desktopWorkflow.actionMenu.parametersHint'), icon: <SlidersHorizontal size={17} />, disabled: props.busy, onClick: props.onParameters },
      ] },
      { type: 'divider' },
      { type: 'group', label: t('desktopWorkflow.actionMenu.files'), children: [
        ...(props.onImport ? [{ key: 'import', label: label('desktopWorkflow.exchange.import', 'desktopWorkflow.exchange.importHint'), icon: <FileInput size={17} />, disabled: props.busy || props.exchangeBusy, onClick: props.onImport }] : []),
        ...(props.onExport ? [{ key: 'export', label: label('desktopWorkflow.exchange.export', props.dirty ? 'desktopWorkflow.exchange.saveFirst' : 'desktopWorkflow.exchange.exportHint'), icon: <FileOutput size={17} />, disabled: !props.revision || props.busy || props.exchangeBusy, onClick: props.onExport }] : []),
        { key: 'history', label: label('desktopWorkflow.history', 'desktopWorkflow.actionMenu.historyHint'), icon: <History size={17} />, disabled: !props.revision || props.busy, onClick: props.onHistory },
      ] },
      { type: 'divider' },
      { key: 'copy', label: t('desktopWorkflow.copy'), icon: <Copy size={16} />, disabled: props.busy, onClick: props.onCopy },
      { key: 'delete', label: t('desktopWorkflow.delete'), icon: <Trash2 size={16} />, disabled: !props.revision || props.busy, danger: true, onClick: props.onRemove },
    ] }}>
    <Button type="text" className={styles.trigger} data-tour="automation-functions" aria-label={t('desktopWorkflow.moreActions')} aria-haspopup="menu" aria-expanded={open} disabled={props.busy}>
      {t('desktopWorkflow.actionMenu.trigger')}<ChevronDown size={13} className={styles.chevron} data-open={open || undefined} />
    </Button>
  </Dropdown>
}
