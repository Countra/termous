import { Alert, Button, Input, InputNumber, Modal } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisImageQuery, AnalysisQuery, AnalysisRecord, AnalysisRenderedImage } from '#common/contracts'
import { saveAnalysisDownload } from '../model/useVisibleQuery'
import styles from './AnalysisImage.module.scss'

export function AnalysisImageActions({ record, gateway, query, layer, active }: {
  record: AnalysisRecord; gateway: AnalysisGateway; query: AnalysisQuery; layer: 'elements' | 'ocr'; active: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return <>
    <Button size="small" onClick={() => setOpen(true)}>{t('analysisCenter.image.open')}</Button>
    {open && active && <ImageDialog key={JSON.stringify([record.id, layer, query])} record={record} gateway={gateway} query={query} layer={layer} onClose={() => setOpen(false)} />}
  </>
}

function ImageDialog({ record, gateway, query, layer, onClose }: {
  record: AnalysisRecord; gateway: AnalysisGateway; query: AnalysisQuery; layer: 'elements' | 'ocr'; onClose: () => void
}) {
  const { t } = useTranslation()
  const [crop, setCrop] = useState('')
  const [maxSide, setMaxSide] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [rendered, setRendered] = useState<AnalysisRenderedImage>()
  const [url, setURL] = useState<string>()
  const pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (!rendered) return
    const value = URL.createObjectURL(rendered.blob); setURL(value)
    return () => URL.revokeObjectURL(value)
  }, [rendered])
  const generate = async (download = false) => {
    const filter = { ...query }
    delete filter.sort; delete filter.cursor; delete filter.limit
    const options: AnalysisImageQuery = { ...filter, layer }
    if (crop.trim()) {
      const parts = crop.split(','); const b = parts.map(Number)
      if (parts.length !== 4 || parts.some(part => !part.trim()) || !b.every(Number.isSafeInteger)
        || b[0] < 0 || b[1] < 0 || b[2] <= b[0] || b[3] <= b[1] || b[2] > record.image!.width || b[3] > record.image!.height) {
        setError(t('analysisCenter.image.invalidCrop')); return
      }
      options.crop = b as [number, number, number, number]
    }
    if (maxSide !== null) {
      if (!Number.isInteger(maxSide) || maxSide < 256 || maxSide > 4096) { setError(t('analysisCenter.image.invalidSize')); return }
      options.max_side = maxSide
    }
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(undefined)
    try {
      const result = await gateway.renderAnalysisImage(record.id, options, controller.signal)
      if (!controller.signal.aborted) {
        setRendered(result)
        if (download) saveAnalysisDownload(result.blob, `termous-analysis-${record.id}-${layer}-filtered.png`)
      }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t('analysisCenter.operationFailed')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <Modal open width={960} title={t('analysisCenter.image.title')} onCancel={onClose} footer={null}>
    <p>{t(layer === 'ocr' ? 'analysisCenter.image.ocrHint' : 'analysisCenter.image.elementsHint')}</p>
    <p>{t('analysisCenter.image.filterHint')}</p>
    <div className={styles.controls}>
      <label>{t('analysisCenter.image.crop')}<Input aria-label={t('analysisCenter.image.crop')} value={crop} placeholder="x1,y1,x2,y2" onChange={event => setCrop(event.target.value)} /></label>
      <label>{t('analysisCenter.image.maxSide')}<InputNumber aria-label={t('analysisCenter.image.maxSide')} value={maxSide} min={256} max={4096} onChange={setMaxSide} /></label>
      <Button loading={busy} onClick={() => void generate()}>{t('analysisCenter.image.generate')}</Button>
      <Button disabled={busy} onClick={() => void generate(true)}>{t('analysisCenter.image.export')}</Button>
    </div>
    {error && <Alert type="error" title={error} />}
    {rendered && <p role="status">{t('analysisCenter.image.counts', { matched: rendered.metadata.matched_count, drawn: rendered.metadata.drawn_count,
      width: rendered.metadata.width, height: rendered.metadata.height, crop: rendered.metadata.crop.join(', ') })}</p>}
    {rendered?.metadata.limited_by_inference && <Alert type="info" title={t('analysisCenter.inferenceLimited')} />}
    {url && <img className={styles.preview} src={url} alt={t('analysisCenter.image.title')} />}
  </Modal>
}
