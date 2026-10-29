import { FileCheck2, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentLocalFileResult } from '#entities/agent'
import { FileTextReview } from '#shared/ui'
import styles from './LocalFileResult.module.scss'

export function LocalFileResult({ file }: { file: AgentLocalFileResult }) {
  const { t } = useTranslation()
  const reading = file.action === 'read'
  const Icon = reading ? FileText : FileCheck2
  return <section className={styles.file} aria-label={t(reading ? 'localTools.readFile' : 'localTools.writtenFile')}>
    <header className={styles.header}>
      <Icon size={16} aria-hidden />
      <code>{file.path}</code>
      <span>{file.size.toLocaleString()} B</span>
    </header>
    {reading ? <>
      <div className={styles.meta}>{t('localTools.readRange', { start: file.offset, end: file.nextOffset, total: file.size })}</div>
      {file.partial && <div className={styles.meta}>{t('localTools.readPartial')}</div>}
      {file.previewLimited && <div className={styles.meta}>{t('localTools.previewLimited')}</div>}
      <FileTextReview after={file.text ?? ''} incomplete={file.previewLimited || (file.nextOffset ?? 0) < file.size} />
    </> : <div className={styles.saved}>{t(file.created ? 'localTools.createFile' : file.action === 'edit' ? 'localTools.editFile' : 'localTools.overwriteFile')} · {t('localTools.writtenFile')}</div>}
  </section>
}
