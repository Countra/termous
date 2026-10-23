import { useEffect, useRef, useState } from 'react'
import type { Snapshot } from '#entities/desktop-workflow'
import { analysisTerminal, saveAnalysisDownload, useVisibleQuery, type AnalysisRecord, type AnalysisGeometry } from '#entities/screen-analysis'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

type Perform = (work: (signal: AbortSignal) => Promise<void>) => Promise<boolean>

export function useScreenAnalysis(gateway: WorkflowMediaGateway, preview: string | undefined, perform: Perform,
  onSnapshot: (value: Snapshot) => void, onError: (error: unknown) => void, active = true) {
  const [submitted, setSubmitted] = useState<AnalysisRecord>()
  const [analysis, setAnalysis] = useState<AnalysisRecord>()
  const [geometry, setGeometry] = useState<AnalysisGeometry[]>([])
  const [selected, setSelected] = useState<number>()
  const [hovered, setHovered] = useState<number>()
  const [actionable, setActionable] = useState(false)
  const [imageError, setImageError] = useState<unknown>()
  const [imageRevision, setImageRevision] = useState(0)
  const version = useRef({ value: 0 })
  const request = useRef<{ preview: string; id: string } | undefined>(undefined)
  const callbacks = useRef({ onSnapshot, onError }); callbacks.current = { onSnapshot, onError }
  const poll = useVisibleQuery(submitted?.id ?? '', signal => gateway.getAnalysis(submitted!.id, signal), !!submitted && active, value => !analysisTerminal(value.state))
  const record = poll.data ?? submitted
  const clear = () => { version.current.value++; request.current = undefined; setSubmitted(undefined); setAnalysis(undefined); setGeometry([]); setSelected(undefined); setHovered(undefined); setActionable(false); setImageError(undefined) }
  useEffect(() => { const counter = version.current; clear(); return () => { counter.value++ } }, [preview])
  useEffect(() => {
    if (record?.state === 'failed' || record?.state === 'interrupted') callbacks.current.onError(new Error(record.error ?? 'analysis_failed'))
  }, [record?.state, record?.error])
  useEffect(() => {
    if (record?.state !== 'succeeded' || !record.metadata || !active) return
    const current = version.current.value
    const controller = new AbortController()
    setImageError(undefined)
    void Promise.all([gateway.analysisImage(record.id, 'original', controller.signal), gateway.analysisGeometry(record.id, controller.signal)])
      .then(([blob, geometry]) => {
        if (controller.signal.aborted || current !== version.current.value) return
        callbacks.current.onSnapshot({ metadata: record.metadata!, blob }); setGeometry(geometry); setAnalysis(record)
      }).catch(error => { if (!controller.signal.aborted) setImageError(error) })
    return () => controller.abort()
  }, [gateway, record, active, imageRevision])
  useEffect(() => {
    if (!analysis?.action_expires_at || analysis.source.kind !== 'preview' || analysis.source.id !== preview) { setActionable(false); return }
    const remaining = Date.parse(analysis.action_expires_at) - Date.now()
    setActionable(remaining > 0)
    const timer = setTimeout(() => setActionable(false), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [analysis, preview])
  const analyze = () => {
    if (!preview) return
    const pending = request.current?.preview === preview ? request.current : { preview, id: crypto.randomUUID() }
    request.current = pending
    const current = version.current.value
    void perform(async signal => {
      const value = await gateway.submitAnalysis({ request_id: pending.id, source: { kind: 'preview', id: preview } }, signal)
      if (!signal.aborted && current === version.current.value) {
        request.current = undefined; setSubmitted(value); setAnalysis(undefined); setGeometry([]); setSelected(undefined); setHovered(undefined); setImageError(undefined)
      }
    })
  }
  const cancel = () => { if (record) void gateway.cancelAnalysis(record.id).then(() => poll.reload()).catch(callbacks.current.onError) }
  const download = (kind: 'json' | 'png') => {
    if (!analysis) return
    const value = analysis
    void perform(async signal => {
      const blob = kind === 'json' ? await gateway.exportAnalysis(value.id, signal) : await gateway.analysisImage(value.id, 'annotated', signal)
      if (!signal.aborted) saveAnalysisDownload(blob, `termous-analysis-${value.id}.${kind}`)
    })
  }
  return { analysis, record, geometry, actionable, selected, hovered, analyzing: !!record && !analysisTerminal(record.state),
    readError: poll.error ?? imageError, setSelected, setHovered, clear, analyze, cancel, download,
    retry: () => { if (imageError) setImageRevision(value => value + 1); else poll.reload() } }
}
