import { Alert, App, Button, Spin, Tag } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway } from '#common/contracts'
import { analysisTerminal, saveAnalysisDownload, useVisibleQuery } from '../model/useVisibleQuery'
import { AnalysisPanel } from './AnalysisPanel'
import { AnalysisOverlay } from './AnalysisOverlay'
import { ReanalyzeDialog } from './ReanalyzeDialog'
import styles from './History.module.scss'

export function AnalysisRecordDetail({ id, gateway, active, onDeleted, onSelect }: { id: string; gateway: AnalysisGateway; active: boolean; onDeleted: () => void; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const { modal, message } = App.useApp()
  const confirmation = useRef<ReturnType<typeof modal.confirm> | undefined>(undefined)
  useEffect(() => () => confirmation.current?.destroy(), [])
  const [selected, setSelected] = useState<number>()
  const [hovered, setHovered] = useState<number>()
  const [reanalyze, setReanalyze] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setURL] = useState<string>()
  const record = useVisibleQuery(id, signal => gateway.getAnalysis(id, signal), active, value => !analysisTerminal(value.state))
  const done = record.data?.state === 'succeeded'
  const image = useVisibleQuery(id, signal => gateway.analysisImage(id, 'original', signal), active && !!record.data?.sha256)
  const geometry = useVisibleQuery(id, signal => gateway.analysisGeometry(id, signal), active && done)
  useEffect(() => {
    if (!image.data) { setURL(undefined); return }
    const url = URL.createObjectURL(image.data); setURL(url)
    return () => URL.revokeObjectURL(url)
  }, [image.data])
  const failure = () => { void message.error(t('analysisCenter.operationFailed')) }
  const perform = async (work: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await work() } catch { failure() } finally { setBusy(false) }
  }
  const remove = () => { confirmation.current?.destroy(); confirmation.current = modal.confirm({ title: t('analysisCenter.delete'), content: t('analysisCenter.deleteHint'), okButtonProps: { danger: true },
    onOk: async () => { try { await gateway.deleteAnalysis(id); onDeleted() } catch (error) { failure(); throw error } } }) }
  const download = (kind: 'json' | 'png') => { void perform(async () => {
    const blob = kind === 'json' ? await gateway.exportAnalysis(id) : await gateway.analysisImage(id, 'annotated')
    saveAnalysisDownload(blob, `termous-analysis-${id}.${kind}`)
  }) }
  const value = record.data
  return <section className={styles.detail} aria-label={t('analysisCenter.details')}>
    {record.error != null && <Alert type="error" title={t('analysisCenter.readFailed')} action={<Button onClick={record.reload}>{t('app.retry')}</Button>} />}
    {!value && record.loading && <Spin />}
    {value && <>
      <header><div><strong>{value.source.name || value.id}</strong><small>{value.id}</small></div><Tag>{t(`analysisCenter.states.${value.state}`)}</Tag>
        {!analysisTerminal(value.state) && <Button disabled={busy || value.state === 'cancelling'} onClick={() => void perform(async () => { await gateway.cancelAnalysis(id); record.reload() })}>{t('desktopWorkflow.analysis.cancel')}</Button>}
        {analysisTerminal(value.state) && <><Button disabled={!value.sha256 || busy} onClick={() => setReanalyze(true)}>{t('analysisCenter.reanalyze')}</Button><Button danger disabled={busy} onClick={remove}>{t('analysisCenter.delete')}</Button></>}
      </header>
      <p className={styles.muted}>{new Date(value.created_at).toLocaleString()} · {t('analysisCenter.expires', { date: new Date(value.expires_at).toLocaleString() })}</p>
      <p className={styles.muted}>{t('analysisCenter.historyReadonly')}</p>
      {!analysisTerminal(value.state) && <p role="status">{t(`analysisCenter.stages.${value.stage}`)}</p>}
      {value.error && <Alert type="warning" title={t(`analysisCenter.states.${value.state}`)} description={value.error} />}
      {image.error != null && <Button onClick={image.reload}>{t('analysisCenter.retryImage')}</Button>}
      {url && value.image && <div className={styles.image}><div style={{ aspectRatio: `${value.image.width}/${value.image.height}`, maxWidth: 340 * value.image.width / value.image.height }}>
        <img src={url} alt={t('analysisCenter.originalImage')} />
        {geometry.data && <AnalysisOverlay image={value.image} elements={geometry.data} selected={selected} hovered={hovered} disabled={busy} onSelect={setSelected} onHover={setHovered} />}
      </div></div>}
      {geometry.error != null && <Button onClick={geometry.reload}>{t('app.retry')}</Button>}
      {done && <AnalysisPanel analysis={value} gateway={gateway} selected={selected} hovered={hovered} onSelect={setSelected} onHover={setHovered} active={active}
        onExport={download} onError={failure} busy={busy} />}
      {value.confidence_distribution && <details><summary>{t('analysisCenter.distribution')}</summary>
        <table><thead><tr><th>{t('analysisCenter.interval')}</th><th>{t('desktopWorkflow.analysis.detectionScore')}</th><th>{t('desktopWorkflow.analysis.textScore')}</th></tr></thead>
          <tbody>{value.confidence_distribution.detection.map((count, i) => <tr key={i}><td>[{(i / 10).toFixed(1)}, {((i + 1) / 10).toFixed(1)}{i === 9 ? ']' : ')'}</td><td>{count}</td><td>{value.confidence_distribution!.ocr[i]}</td></tr>)}</tbody></table>
      </details>}
      {reanalyze && <ReanalyzeDialog record={value} gateway={gateway} onClose={() => setReanalyze(false)} onDone={id => { setReanalyze(false); onSelect(id) }} />}
    </>}
  </section>
}
