import { Alert, Button, Empty } from 'antd'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisPresentation, AnalysisRecord } from '#common/contracts'
import { useAnalysisResults } from '../../model/useAnalysisResults'
import { useVisibleQuery } from '../../model/useVisibleQuery'
import type { AnalysisPane } from '../../model/explorerLayout'
import { AnalysisExplorerLayout } from './AnalysisExplorerLayout'
import { AnalysisCanvas } from './AnalysisCanvas'
import { AnalysisResults } from './AnalysisResults'

export function AnalysisExplorer({ gateway, record, state, onChange, history, panel, crop, onError }: {
  gateway: AnalysisGateway; record?: AnalysisRecord; state: AnalysisPresentation; onChange: (patch: Partial<AnalysisPresentation>) => void
  history: ReactNode; panel?: { key: string; content: ReactNode }; crop?: [number, number, number, number]; onError: (error: unknown) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState<{ key: string; cursors: (string | undefined)[] }>({ key: '', cursors: [undefined] })
  const [mobile, setMobile] = useState<AnalysisPane>('canvas')
  const panelKey = panel?.key
  useEffect(() => { if (panelKey) setMobile('results') }, [panelKey])
  useEffect(() => { if (state.history) setMobile('results') }, [state.history])
  const key = JSON.stringify([record?.id, state.layer, state.filter])
  const cursors = page.key === key ? page.cursors : [undefined]
  const result = useAnalysisResults(gateway, record?.id ?? '', state.layer, state.filter, cursors[cursors.length - 1], record?.state === 'succeeded')
  const image = useVisibleQuery(record?.id ?? '', async signal => ({ id: record!.id, blob: await gateway.analysisImage(record!.id, 'original', signal) }), !!record?.sha256)
  useEffect(() => {
    if (!result.loading && result.data && state.selected !== undefined && !result.data.geometry.some(item => item.id === state.selected)) onChange({ selected: undefined })
  }, [result.data, result.loading, state.selected, onChange])
  const results = <>
    {panel?.content ?? (record?.state === 'succeeded' ? <AnalysisResults gateway={gateway} id={record.id} state={state} onChange={onChange} result={result} cursor={cursors.length - 1} onError={onError}
        onPage={next => setPage({ key, cursors: next ? [...cursors, result.data!.page.next_cursor] : cursors.slice(0, -1) })} />
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(record ? (['failed', 'cancelled', 'interrupted'].includes(record.state) ? 'desktopWorkflow.analysisWorkspace.failedResult' : 'desktopWorkflow.analysisWorkspace.pendingResult') : 'desktopWorkflow.analysisWorkspace.emptyResult')} />)}
  </>
  return <AnalysisExplorerLayout state={state} onChange={onChange} pane={mobile} onPane={setMobile} history={history} results={results}>
      {image.error != null && <Alert type="error" title={t('analysisCenter.readFailed')} action={<Button onClick={image.reload}>{t('app.retry')}</Button>} />}
      <AnalysisCanvas key={record?.id ?? 'empty'} blob={image.data?.id === record?.id ? image.data?.blob : undefined} image={record?.image} geometry={result.data?.geometry ?? []} selected={state.selected} crop={crop}
        preference={state.view} onViewChange={view => onChange({ view })} onSelect={selected => { if (!result.loading) onChange({ selected }) }} />
  </AnalysisExplorerLayout>
}
