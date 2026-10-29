import { memo, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Pagination, Segmented, Tooltip } from 'antd'
import { WrapText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { lineDiff, reviewRows, textLines, type ReviewLine } from './lineDiff.ts'
import styles from './FileTextReview.module.scss'

interface Props { before?: string; after: string; readOnlyLabel?: string; incomplete?: boolean }
type ReviewMode = 'diff' | 'before' | 'after'
const pageSize = 100

export const FileTextReview = memo(function FileTextReview({ before, after, readOnlyLabel, incomplete }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ReviewMode>('diff')
  const [context, setContext] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [page, setPage] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const diff = useMemo(() => before === undefined ? undefined : lineDiff(before, after), [before, after])
  const effectiveMode = diff ? mode : 'after'
  const rows = useMemo(() => effectiveMode === 'diff' && diff ? reviewRows(diff.lines, context)
    : textLines(effectiveMode === 'before' ? before ?? '' : after).map((text, index) => ({ index, line: { kind: 'equal', text, after: index + 1 } as ReviewLine })),
  [effectiveMode, diff, context, before, after])
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)))
  const reset = () => { setPage(1); if (viewport.current) viewport.current.scrollTop = 0 }
  const changePage = (next: number) => { setPage(next); if (viewport.current) viewport.current.scrollTop = 0 }
  return <section className={styles.review} aria-label={t('fileReview.title')}>
    <div className={styles.toolbar}>
      {diff ? <Segmented<ReviewMode> size="small" value={mode} onChange={value => { setMode(value); reset() }} options={[
        { value: 'diff', label: t('fileReview.diff') }, { value: 'before', label: t('fileReview.before') }, { value: 'after', label: t('fileReview.after') },
      ]} /> : <span className={styles.caption}>{readOnlyLabel ?? t('fileReview.content')}</span>}
      <div className={styles.tools}>
        {diff && <span className={styles.counts} aria-label={t('fileReview.counts', { added: diff.added, removed: diff.removed })}>
          <span data-kind="add">+{diff.added}</span><span data-kind="remove">−{diff.removed}</span>
        </span>}
        <Tooltip title={t('fileReview.wrap')}><Button size="small" type="text" icon={<WrapText size={15} />} aria-label={t('fileReview.wrap')} aria-pressed={wrap} onClick={() => setWrap(value => !value)} /></Tooltip>
      </div>
    </div>
    {diff && <div className={styles.options}>
      <Checkbox checked={context} disabled={mode !== 'diff'} onChange={event => { setContext(event.target.checked); reset() }}>{t('fileReview.context')}</Checkbox>
      <span className={styles.format}>{format(before ?? '')} → {format(after)}</span>
    </div>}
    {diff?.coarse && <p className={styles.notice}>{t('fileReview.coarse')}</p>}
    <div ref={viewport} className={styles.viewport} tabIndex={0} role="region" aria-label={t(effectiveMode === 'diff' ? 'fileReview.diff' : 'fileReview.content')} data-wrap={wrap} data-comparison={Boolean(diff)}>
      {!rows.length ? <div className={styles.empty}>{t('fileReview.empty')}</div> : <div className={styles.lines} data-diff={effectiveMode === 'diff'}>
        {rows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(row => 'omitted' in row
          ? <button type="button" key={row.index} className={styles.omitted} onClick={() => { setContext(true); reset() }}>{t('fileReview.omitted', { count: row.omitted })}</button>
          : <div key={row.index} className={styles.line} data-kind={row.line.kind}>
            {effectiveMode === 'diff' && <span className={styles.number}>{row.line.before ?? ''}</span>}
            <span className={styles.number}>{row.line.after ?? ''}</span>
            {effectiveMode === 'diff' && <span className={styles.sign}>{row.line.kind === 'add' ? '+' : row.line.kind === 'remove' ? '−' : ''}</span>}
            <code>{displayLine(row.line.text)}{!incomplete && !row.line.text.endsWith('\n') && <span className={styles.eof} title={t('fileReview.noNewline')}> ∅↵</span>}</code>
          </div>)}
      </div>}
    </div>
    {diff && diff.added === 0 && diff.removed === 0 && <div className={styles.notice}>{t('fileReview.unchanged')}</div>}
    {(diff?.lines.length ?? rows.length) > pageSize && <div className={styles.pagination}><Pagination size="small" simple current={currentPage} total={rows.length} pageSize={pageSize} onChange={changePage} showSizeChanger={false} /></div>}
  </section>
})

function displayLine(text: string) { return text.replace(/\r?\n$/u, '').replace(/\uFEFF/gu, '⟪BOM⟫') || ' ' }
function format(text: string) {
  const crlf = text.includes('\r\n'), lf = /(?<!\r)\n/u.test(text)
  return `${text.startsWith('\uFEFF') ? 'UTF-8 BOM · ' : ''}${crlf && lf ? 'CRLF / LF' : crlf ? 'CRLF' : lf ? 'LF' : '—'}`
}
