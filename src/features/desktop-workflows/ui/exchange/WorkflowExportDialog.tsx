import { Button, Modal, Radio } from 'antd'
import { ArrowRight, FileJson, FileOutput, Folder, FolderArchive, Image, Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowExportLayout } from '#common/contracts'
import type { Definition } from '#entities/desktop-workflow'
import { workflowSummary } from '../../model/exchange/summary'
import { WorkflowExchangeSummary } from './WorkflowExchangeSummary'
import styles from './WorkflowExportDialog.module.scss'
import shell from './WorkflowExchangeShell.module.scss'

const formats = [
  { value: 'zip', icon: FolderArchive, extension: '.zip' },
  { value: 'directory', icon: Folder, extension: '/' },
  { value: 'json', icon: FileJson, extension: '.json' },
] as const

export function WorkflowExportDialog({ name, revision, definition, onExport, onClose }: {
  name: string; revision: number; definition: Definition
  onExport: (layout: WorkflowExportLayout) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const [layout, setLayout] = useState<WorkflowExportLayout>('zip')
  const summary = workflowSummary(definition)
  return <Modal open centered width={760} className={shell.dialog} title={<div className={shell.heading}>
    <span className={shell['heading-icon']}><FileOutput size={21} /></span><div><h2>{t('desktopWorkflow.exchange.export')}</h2><p>{t('desktopWorkflow.exchange.exportIntro')}</p></div>
  </div>} onCancel={onClose} footer={<div className={shell.footer}>
    <div><Button onClick={onClose}>{t('app.cancel')}</Button>
      <Button type="primary" icon={<ArrowRight size={15} />} iconPlacement="end" onClick={() => onExport(layout)}>{t('desktopWorkflow.exchange.chooseLocation')}</Button></div>
  </div>}>
    <div className={shell.body}>
      <WorkflowExchangeSummary name={name} revision={revision} definition={definition} />
      <div className={styles.layout}>
        <section className={styles.formats} aria-label={t('desktopWorkflow.exchange.format')}>
          <h3>{t('desktopWorkflow.exchange.format')}</h3>
          <Radio.Group className={styles.options} aria-label={t('desktopWorkflow.exchange.format')} value={layout} onChange={event => setLayout(event.target.value)}>
            {formats.map(({ value, icon: Icon, extension }) => <Radio key={value} value={value} disabled={value === 'json' && summary.hasAssets}
              className={styles.option}>
              <span className={styles['format-icon']}><Icon size={20} /></span>
              <span className={styles['format-copy']}><span className={styles['format-title']}>{t(`desktopWorkflow.exchange.formats.${value}.title`)}{value === 'zip' && <small>{t('desktopWorkflow.exchange.recommended')}</small>}</span>
                <span className={styles['format-description']}>{t(value === 'json' && summary.hasAssets ? 'desktopWorkflow.exchange.jsonUnavailable' : `desktopWorkflow.exchange.formats.${value}.description`)}</span></span>
              <code>{extension}</code>
            </Radio>)}
          </Radio.Group>
        </section>
        <aside className={styles.preview} aria-label={t('desktopWorkflow.exchange.filePreview')}>
          <h3>{t('desktopWorkflow.exchange.filePreview')}</h3>
          <div className={styles.tree}>
            {layout !== 'json' && <div className={styles['tree-root']}>{layout === 'zip' ? <FolderArchive size={16} /> : <Folder size={16} />}<span>{layout === 'zip' ? 'workflow.termous-workflow.zip' : 'workflow.termous-workflow/'}</span></div>}
            <div className={styles.files} data-nested={layout !== 'json' || undefined}>
              <div><FileJson size={15} /><span>workflow.json</span></div>
              {summary.hasAssets && <div><Folder size={15} /><span>assets/</span><Image size={13} /></div>}
            </div>
          </div>
          <p>{t(`desktopWorkflow.exchange.formats.${layout}.preview`)}</p>
        </aside>
      </div>
      <div className={shell.notice}><Info size={16} /><p>{t('desktopWorkflow.exchange.disclosure')}</p></div>
    </div>
  </Modal>
}
