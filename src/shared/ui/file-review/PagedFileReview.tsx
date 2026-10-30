import { useState, type CSSProperties } from 'react'
import { Button, Checkbox, Segmented, Spin, Tooltip } from 'antd'
import { WrapText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileReview, FileReviewLoader, FileReviewMode } from '#shared/file-review'
import { useFileReviewPage } from './useFileReviewPage.ts'
import styles from './FileTextReview.module.scss'

interface Props { review: FileReview; load?: FileReviewLoader; history?: boolean }

export function PagedFileReview(props: Props) {
  return <ReviewSession key={`${props.review.id}:${props.review.digest}`} {...props} />
}

function ReviewSession({ review, load, history }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<FileReviewMode>('diff')
  const [all, setAll] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [navigation, setNavigation] = useState({ cursor: '', back: [] as string[], page: 1 })
  const { page, loading, failed, retry } = useFileReviewPage(review.id,
    { digest: review.digest, mode, cursor: navigation.cursor || undefined, context: all ? 'all' : undefined }, load)
  const reset = () => setNavigation({ cursor: '', back: [], page: 1 })
  const expand = () => { setAll(true); reset() }
  const digits = String(Math.max(1, ...page?.rows.flatMap(row => [row.before_line ?? 0, row.after_line ?? 0]) ?? [])).length
  return <section className={styles.review} aria-label={t('fileReview.title')} style={{ '--file-review-line-number-width': `${Math.max(40, digits * 7 + 12)}px` } as CSSProperties}>
    <div className={styles.toolbar}>
      {history ? <span>{t('fileReview.diff')}</span> : <Segmented<FileReviewMode> size="small" value={mode} onChange={value => { setMode(value); reset() }} options={[
        { value: 'diff', label: t('fileReview.diff') }, { value: 'before', label: t('fileReview.before') }, { value: 'after', label: t('fileReview.after') },
      ]} />}
      <div className={styles.tools}><span className={styles.caption}>{t('fileReview.changes', { count: review.change_count })}</span>
        <Tooltip title={t('fileReview.wrap')}><Button size="small" type="text" icon={<WrapText size={15} />} aria-label={t('fileReview.wrap')} aria-pressed={wrap} onClick={() => setWrap(value => !value)} /></Tooltip>
      </div>
    </div>
    {!history && <div className={styles.options}><Checkbox checked={all} disabled={mode !== 'diff'} onChange={event => { setAll(event.target.checked); reset() }}>{t('fileReview.context')}</Checkbox><span className={styles.format}>{t('fileReview.fixedVersion')}</span></div>}
    {review.coarse && <p className={styles.notice}>{t('fileReview.coarse')}</p>}
    <div key={`${mode}:${all}:${navigation.page}`} className={styles.viewport} tabIndex={0} role="region" aria-busy={loading} aria-label={t(mode === 'diff' ? 'fileReview.diff' : 'fileReview.content')} data-wrap={wrap} data-comparison="true">
      {loading ? <div className={styles.empty}><Spin size="small" /></div> : failed ? <div className={styles.empty} role="alert"><span>{t('fileReview.loadFailed')}</span><Button size="small" onClick={retry}>{t('app.retry')}</Button></div>
        : !page?.rows.length ? <div className={styles.empty}>{t('fileReview.empty')}</div> : <div className={styles.lines} data-diff={mode === 'diff'}>
          {page.rows.map((row, index) => row.kind === 'omitted'
            ? history ? <div key={index} className={styles.notice}>{t('fileReview.historyContext')}</div> : <button key={index} type="button" className={styles.omitted} onClick={expand}>{t('fileReview.expandContext')}</button>
            : <div key={index} className={styles.line} data-kind={row.kind}>
              {mode === 'diff' && <span className={styles.number}>{row.before_line ?? ''}</span>}
              <span className={styles.number}>{mode === 'before' ? row.before_line : row.after_line ?? ''}</span>
              {mode === 'diff' && <span className={styles.sign}>{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''}</span>}
              <code>{row.text.replace(/\r?\n$/u, '').replace(/\uFEFF/gu, '⟪BOM⟫') || ' '}{row.partial ? <span className={styles.eof} title={t('fileReview.partialLine')}> ↪</span>
                : !row.text.endsWith('\n') && <span className={styles.eof} title={t('fileReview.noNewline')}> ∅↵</span>}</code>
            </div>)}
        </div>}
    </div>
    <div className={styles.pagination}>
      <Button size="small" type="text" disabled={loading || navigation.page === 1} onClick={reset}>{t('fileReview.firstPage')}</Button>
      <Button size="small" type="text" disabled={loading || !navigation.back.length} onClick={() => setNavigation(value => ({ cursor: value.back[value.back.length - 1] ?? '', back: value.back.slice(0, -1), page: value.page - 1 }))}>{t('fileReview.previousPage')}</Button>
      <span className={styles['page-number']}>{t('fileReview.page', { page: navigation.page })}</span>
      <Button size="small" type="text" disabled={loading || failed || !page?.cursor} onClick={() => { if (page?.cursor) setNavigation(value => ({ cursor: page.cursor!, back: [...value.back, value.cursor].slice(-32), page: value.page + 1 })) }}>{t('fileReview.nextPage')}</Button>
    </div>
  </section>
}
