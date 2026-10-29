import { FilePlus2, FilePenLine, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpApprovalOperation } from '#entities/mcp-access'
import { FileTextReview } from '#shared/ui'
import styles from './LocalFileApproval.module.scss'

export function LocalFileApproval({ file }: { file: NonNullable<McpApprovalOperation['local']> }) {
  const { t } = useTranslation()
  const path = file.path ?? ''
  const name = path.split(/[\\/]/u).pop() || path
  const Icon = file.create ? FilePlus2 : FilePenLine
  const action = file.create ? 'createFile' : file.tool.endsWith('.edit') ? 'editFile' : 'overwriteFile'
  return <section className={styles.file} aria-label={t(`localTools.${action}`)}>
    <header className={styles.header}>
      <span className={styles.icon}><Icon size={19} aria-hidden /></span>
      <div className={styles.identity}><strong>{name}</strong><span>{path}</span></div>
      <span className={styles.action} data-create={file.create}>{t(`localTools.${action}`)}</span>
    </header>
    <div className={styles.metadata}>
      <span className={styles.directory} title={file.directory}><FolderOpen size={13} aria-hidden /><span>{file.directory}</span></span>
      <span>{file.create ? '' : `${file.before_bytes} B → `}{file.after_bytes} B</span>
    </div>
    <FileTextReview before={file.before} after={file.after} />
  </section>
}
