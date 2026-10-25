import { Alert, Button, Segmented } from 'antd'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisLayer, AnalysisPresentation } from '#common/contracts'
import type { useAnalysisResults } from '../../model/useAnalysisResults'
import { AnalysisElementDetail } from '../AnalysisElementDetail'
import { AnalysisFilterEditor } from './AnalysisFilterEditor'
import { AnalysisFilterPopover } from './AnalysisFilterPopover'
import { AnalysisSearch } from './AnalysisSearch'
import { AnalysisResultItem } from './AnalysisResultItem'
import styles from './Explorer.module.scss'

export function AnalysisResults({ gateway, id, state, onChange, result, cursor, onPage, onError }: {
  gateway: AnalysisGateway; id: string; state: AnalysisPresentation; onChange: (patch: Partial<AnalysisPresentation>) => void
  result: ReturnType<typeof useAnalysisResults>; cursor: number; onPage: (next: boolean) => void; onError: (error: unknown) => void
}) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState({ key: '', open: true })
  const list = useRef<HTMLDivElement>(null)
  const wasDetail = useRef(false)
  const data = result.data
  const chosen = data?.geometry.find(item => item.id === state.selected)
  const filterCount = Object.entries(state.filter).filter(([key, value]) => !['q', 'cursor', 'limit', 'sort'].includes(key) && value !== undefined).length
  const selectionKey = `${id}:${state.layer}:${state.selected}`
  const showDetail = !!chosen && (detail.key !== selectionKey || detail.open)
  useEffect(() => {
    if (!showDetail && wasDetail.current) list.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true })
    wasDetail.current = showDetail
  }, [showDetail])
  const select = (selected: number, open: boolean) => { setDetail({ key: `${id}:${state.layer}:${selected}`, open }); onChange({ selected }) }
  return <section className={styles.results}>
    <div className={styles['result-toolbar']}>
      <div className={styles['result-heading']}><Segmented block value={state.layer} options={[{ value: 'elements', label: t('desktopWorkflow.analysisWorkspace.elements') }, { value: 'ocr', label: t('desktopWorkflow.analysisWorkspace.ocr') }]}
        onChange={layer => onChange({ layer: layer as AnalysisLayer, filter: {}, selected: undefined })} /></div>
      <div className={styles.search}>
        <AnalysisSearch key={`search:${id}:${state.layer}`} value={state.filter.q} placeholder={t('desktopWorkflow.analysis.search')} onChange={q => onChange({ filter: { ...state.filter, q }, selected: undefined })} />
        <AnalysisFilterPopover key={`filter:${id}:${state.layer}`} count={filterCount} onReset={() => onChange({ filter: { q: state.filter.q }, selected: undefined })}>
          <AnalysisFilterEditor value={state.filter} ocr={state.layer === 'ocr'} onChange={filter => onChange({ filter, selected: undefined })} />
        </AnalysisFilterPopover>
      </div>
    </div>
    <div className={styles['list-view']} hidden={showDetail}>
      <div className={styles['result-status']} role="status">{t('analysisCenter.matches', { count: data?.page.total ?? 0 })}{result.loading && <span>{t('desktopWorkflow.analysisWorkspace.loading')}</span>}</div>
      {result.error != null && <Alert type="error" title={t('analysisCenter.readFailed')} action={<Button onClick={result.reload}>{t('app.retry')}</Button>} />}
      {data?.page.limited_by_inference && <small className={styles.hint}>{t('analysisCenter.inferenceLimited')}</small>}
      <div ref={list} className={styles['result-list']} role="list" aria-busy={result.loading} aria-label={t(`desktopWorkflow.analysisWorkspace.${state.layer}`)}>
        {data?.page.items.map(item => <AnalysisResultItem key={item.id} item={item} selected={item.id === state.selected} disabled={result.loading}
          onSelect={() => select(item.id, false)} onDetails={() => select(item.id, true)} />)}
        {data?.page.total === 0 && <p className={styles.hint}>{t('desktopWorkflow.analysis.empty')}</p>}
      </div>
      <div className={styles.pagination}><Button disabled={!cursor || result.loading} onClick={() => onPage(false)}>{t('desktopWorkflow.analysis.previous')}</Button><span>{cursor + 1}</span><Button disabled={!data?.page.next_cursor || result.loading} onClick={() => onPage(true)}>{t('desktopWorkflow.analysis.next')}</Button></div>
    </div>
    {showDetail && chosen && <div className={styles['detail-view']}>
      <header><Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => setDetail({ key: selectionKey, open: false })}>{t('desktopWorkflow.analysisWorkspace.back')}</Button>
        <span>{state.layer === 'ocr' ? 'OCR ' : ''}#{chosen.id}</span></header>
      <AnalysisElementDetail key={`${id}:${state.layer}:${chosen.id}`} gateway={gateway} id={id} selected={chosen.element_id ?? chosen.id} span={state.layer === 'ocr' ? chosen.id : undefined}
        filter={state.filter} active onError={onError} onSelectSpan={selected => onChange({ layer: 'ocr', filter: {}, selected })} />
    </div>}
  </section>
}
