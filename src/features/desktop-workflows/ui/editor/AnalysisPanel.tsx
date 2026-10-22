import { Button, Input, Tooltip } from 'antd'
import { Copy, Download, FileJson, Crosshair, Scan, ImagePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisElement, ScreenAnalysis } from '#entities/desktop-workflow'
import { writeClipboardText } from '#shared/clipboard'
import styles from './ScreenAnalysis.module.scss'

interface Props {
  analysis: ScreenAnalysis; selected?: number; hovered?: number; busy: boolean; canPoint: boolean; canRegion: boolean
  onSelect: (id: number) => void; onHover: (id?: number) => void
  onApply: (kind: 'point' | 'template' | 'region', element: AnalysisElement) => void
  onExport: (kind: 'json' | 'png') => void; onError: (error: unknown) => void
}

export function AnalysisPanel({ analysis, selected, hovered, busy, canPoint, canRegion, onSelect, onHover, onApply, onExport, onError }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const elements = analysis.result.elements
  const current = elements.find(element => element.id === selected)
  const filtered = elements.filter(element => `${element.id} ${element.text}`.toLowerCase().includes(query.toLowerCase()))
  const selectedPage = Math.floor(filtered.findIndex(element => element.id === selected) / 50)
  useEffect(() => { if (selectedPage >= 0) setPage(selectedPage) }, [selectedPage, selected])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [page, selected])
  return <section className={styles.panel} aria-label={t('desktopWorkflow.analysis.title')}>
    <header className={styles.heading}>
      <strong>{t('desktopWorkflow.analysis.title')}</strong>
      <span>{t('desktopWorkflow.analysis.count', { count: elements.length })} · {(analysis.result.total_ms / 1000).toFixed(2)} s</span>
      <Tooltip title={t('desktopWorkflow.analysis.exportJSON')}><Button size="small" type="text" aria-label={t('desktopWorkflow.analysis.exportJSON')} icon={<FileJson size={14} />} onClick={() => onExport('json')} /></Tooltip>
      <Tooltip title={t('desktopWorkflow.analysis.exportPNG')}><Button size="small" type="text" disabled={busy} aria-label={t('desktopWorkflow.analysis.exportPNG')} icon={<Download size={14} />} onClick={() => onExport('png')} /></Tooltip>
    </header>
    {analysis.result.truncated && <p className={styles.notice}>{t('desktopWorkflow.analysis.truncated')}</p>}
    <Input size="small" aria-label={t('desktopWorkflow.analysis.search')} placeholder={t('desktopWorkflow.analysis.search')} value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} />
    <div className={styles.list} ref={list} role="listbox" aria-label={t('desktopWorkflow.analysis.elements')}>
      {filtered.slice(page * 50, (page + 1) * 50).map(element => <button type="button" role="option" key={element.id}
        aria-selected={element.id === selected} data-active={element.id === hovered} onClick={() => onSelect(element.id)}
        onPointerEnter={() => onHover(element.id)} onPointerLeave={() => onHover(undefined)}>
        <span className={styles.number}>{element.id}</span><span className={styles.text}>{element.text || t('desktopWorkflow.analysis.unlabelled')}</span>
        <small>{t(`desktopWorkflow.analysis.${element.type}`)}</small>
      </button>)}
      {!filtered.length && <p className={styles.empty}>{t('desktopWorkflow.analysis.empty')}</p>}
    </div>
    {filtered.length > 50 && <div className={styles.pages}>
      <Button size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('desktopWorkflow.analysis.previous')}</Button>
      <span>{page + 1} / {Math.ceil(filtered.length / 50)}</span>
      <Button size="small" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(page + 1)}>{t('desktopWorkflow.analysis.next')}</Button>
    </div>}
    {current && <div className={styles.detail}>
      <div><strong>#{current.id}</strong><span>{current.bbox_xyxy.map(value => Math.round(value)).join(', ')}</span></div>
      {current.confidence != null && <small>{t('desktopWorkflow.analysis.detectionScore')}: {current.confidence.toFixed(3)}</small>}
      {(current.text_spans ?? (current.text_confidence != null ? [current] : [])).map((span, index) => <p key={index}>{span.text} <small>OCR {span.text_confidence?.toFixed(3)}</small></p>)}
      <div className={styles.actions}>
        {current.text && <Button size="small" icon={<Copy size={13} />} onClick={() => void writeClipboardText(current.text).catch(onError)}>{t('desktopWorkflow.analysis.copy')}</Button>}
        <Button size="small" disabled={busy || !canPoint} icon={<Crosshair size={13} />} onClick={() => onApply('point', current)}>{t('desktopWorkflow.analysis.usePoint')}</Button>
        <Button size="small" disabled={busy || !canRegion} icon={<ImagePlus size={13} />} onClick={() => onApply('template', current)}>{t('desktopWorkflow.analysis.useTemplate')}</Button>
        <Button size="small" disabled={busy || !canRegion} icon={<Scan size={13} />} onClick={() => onApply('region', current)}>{t('desktopWorkflow.analysis.useRegion')}</Button>
      </div>
    </div>}
  </section>
}
