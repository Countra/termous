import { FileCheck2, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentLocalFileResult } from '#entities/agent'
import { FileTextReview, PagedFileReview } from '#shared/ui'
import { Button } from 'antd'
import { useMemo, useState } from 'react'
import type { FileHistoryLoader, FileReviewLoader } from '#shared/file-review'
import styles from './LocalFileResult.module.scss'

export function LocalFileResult({ file, onLoadFileReview }: { file: AgentLocalFileResult; onLoadFileReview?: FileHistoryLoader }) {
  const { t } = useTranslation()
  const [reviewing, setReviewing] = useState(false)
  const reviewId = file.review?.id
  const load = useMemo<FileReviewLoader | undefined>(() => onLoadFileReview && reviewId ? (query, signal) => {
    signal.throwIfAborted()
    return onLoadFileReview(reviewId, query.digest, query.cursor)
  } : undefined, [onLoadFileReview, reviewId])
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
      {(file.startLine || file.consistency) && <div className={styles.meta}>{file.startLine && file.endLine ? t('localTools.lineRange', { start: file.startLine, end: file.endLine }) : ''} {file.consistency ? t(`localTools.consistency.${file.consistency}`) : ''}</div>}
      {file.partial && <div className={styles.meta}>{t('localTools.readPartial')}</div>}
      {file.previewLimited && <div className={styles.meta}>{t('localTools.previewLimited')}</div>}
      <FileTextReview after={file.text ?? ''} incomplete={file.previewLimited || (file.nextOffset ?? 0) < file.size} />
    </> : <div className={styles.saved}>{file.changed === false ? t('fileReview.unchanged') : <>{t(file.created ? 'localTools.createFile' : file.action === 'edit' ? 'localTools.editFile' : 'localTools.overwriteFile')} · {t('localTools.writtenFile')}{file.changeCount !== undefined ? ` · ${t('fileReview.changes', { count: file.changeCount })}` : ''}</>}</div>}
    {file.review && <><Button size="small" type="text" onClick={() => setReviewing(value => !value)} aria-expanded={reviewing}>{t('localTools.reviewChanges')}</Button>
      {reviewing && <PagedFileReview review={file.review} load={load} history />}</>}
  </section>
}
