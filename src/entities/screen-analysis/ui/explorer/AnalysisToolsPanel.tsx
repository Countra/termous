import { Alert, Button, Input, InputNumber } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisParameterBounds, analysisParameterEnabled, isScreenAnalysisParameters, type AnalysisGateway, type AnalysisImageQuery, type AnalysisPresentation, type AnalysisRecord, type ScreenAnalysisParameters } from '#common/contracts'
import { saveAnalysisDownload } from '../../model/useVisibleQuery'
import { AnalysisRecordDetails } from './AnalysisRecordDetails'
import { AnalysisModeSelect } from '../AnalysisModeSelect'
import styles from './Explorer.module.scss'

export function AnalysisToolsPanel({ kind, record, gateway, state, busy, onReanalyze, onCrop, onClose }: {
  kind: 'parameters' | 'export' | 'details'; record: AnalysisRecord; gateway: AnalysisGateway; state: AnalysisPresentation; busy: boolean
  onReanalyze: (parameters: ScreenAnalysisParameters) => Promise<void>; onCrop: (crop?: [number, number, number, number]) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const [parameters, setParameters] = useState<{ [K in keyof ScreenAnalysisParameters]: ScreenAnalysisParameters[K] | null }>({ ...record.parameters })
  const [crop, setCrop] = useState('')
  const [maxSide, setMaxSide] = useState<number | null>(1600)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => request.current?.abort(), [])
  const parseCrop = (raw: string) => {
    if (!raw.trim()) return undefined
    const box = raw.split(',').map(Number)
    if (!record.image || raw.split(',').some(s => !s.trim()) || box.length !== 4 || !box.every(Number.isSafeInteger) || box[0] < 0 || box[1] < 0 || box[2] <= box[0] || box[3] <= box[1] || box[2] > record.image.width || box[3] > record.image.height) throw new Error(t('analysisCenter.image.invalidCrop'))
    return box as [number, number, number, number]
  }
  const download = async (format: 'json' | 'original' | 'filtered') => {
    if (working || busy) return
    const controller = new AbortController(); request.current = controller
    setWorking(true); setError(undefined)
    try {
      const filter = { ...state.filter }
      delete filter.sort; delete filter.cursor; delete filter.limit
      let blob: Blob
      if (format === 'json') blob = await gateway.exportAnalysis(record.id, controller.signal)
      else if (format === 'original') blob = await gateway.analysisImage(record.id, 'original', controller.signal)
      else {
        if (maxSide === null || !Number.isInteger(maxSide) || maxSide < 256 || maxSide > 4096) throw new Error(t('analysisCenter.image.invalidSize'))
        const query: AnalysisImageQuery = { ...filter, layer: state.layer, crop: parseCrop(crop), max_side: maxSide, label_mode: state.view?.labelMode ?? 'auto' }
        blob = (await gateway.renderAnalysisImage(record.id, query, controller.signal)).blob
      }
      if (!controller.signal.aborted) saveAnalysisDownload(blob, `termous-analysis-${record.id}-${format}.${format === 'json' ? 'json' : 'png'}`)
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t('analysisCenter.operationFailed')) }
    finally { if (!controller.signal.aborted) setWorking(false) }
  }
  if (kind === 'details') return <AnalysisRecordDetails record={record} gateway={gateway} onBack={onClose} />
  return <div className={styles.scroll} style={{ height: '100%' }}><div className={styles.form}>
    <div className={styles.actions}><strong style={{ marginRight: 'auto' }}>{t(`desktopWorkflow.analysisWorkspace.${kind}`)}</strong><Button onClick={onClose}>{t('desktopWorkflow.analysisWorkspace.back')}</Button></div>
    {kind === 'parameters' && <>
      <p className={styles.hint}>{t('desktopWorkflow.analysisWorkspace.reanalyzeHint')}</p>
      <AnalysisModeSelect value={{ detector_enabled: parameters.detector_enabled === true, ocr_enabled: parameters.ocr_enabled === true }} disabled={busy} onChange={mode => setParameters({ ...parameters, ...mode })} />
      {(Object.keys(analysisParameterBounds) as (keyof typeof analysisParameterBounds)[]).map(key => <label key={key}>{t(`settings.screenAnalysis.${key}`)}
        <InputNumber {...analysisParameterBounds[key]} value={parameters[key]} disabled={busy || !analysisParameterEnabled(key, { detector_enabled: parameters.detector_enabled === true, ocr_enabled: parameters.ocr_enabled === true })}
          onChange={value => setParameters({ ...parameters, [key]: value })} /></label>)}
      <Button type="primary" loading={busy} disabled={!isScreenAnalysisParameters(parameters)} onClick={() => { if (isScreenAnalysisParameters(parameters)) void onReanalyze(parameters) }}>{t('analysisCenter.reanalyze')}</Button>
    </>}
    {kind === 'export' && <>
      <Button disabled={working || busy || record.state !== 'succeeded'} onClick={() => void download('json')}>{t('desktopWorkflow.analysisWorkspace.exportJSON')}</Button>
      <Button disabled={working || busy || !record.sha256} onClick={() => void download('original')}>{t('analysisCenter.originalImage')}</Button>
      <label>{t('analysisCenter.image.crop')}<Input value={crop} placeholder="x1, y1, x2, y2" onChange={e => {
        setCrop(e.target.value)
        try { onCrop(parseCrop(e.target.value)); setError(undefined) } catch { onCrop(undefined) }
      }} /></label>
      <label>{t('analysisCenter.image.maxSide')}<InputNumber min={256} max={4096} value={maxSide} onChange={setMaxSide} /></label>
      <Button type="primary" loading={working} disabled={busy || record.state !== 'succeeded'} onClick={() => void download('filtered')}>{t('desktopWorkflow.analysisWorkspace.exportFiltered')}</Button>
    </>}
    {error && <Alert type="error" title={error} />}
  </div></div>
}
