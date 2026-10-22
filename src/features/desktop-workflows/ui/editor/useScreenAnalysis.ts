import { useEffect, useRef, useState } from 'react'
import type { ScreenAnalysis, Snapshot } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { exportAnalysis } from '../../model/analysis'

type Perform = (work: (signal: AbortSignal) => Promise<void>) => Promise<boolean>

export function useScreenAnalysis(gateway: WorkflowMediaGateway, preview: string | undefined, perform: Perform, onSnapshot: (value: Snapshot) => void) {
  const [analysis, setAnalysis] = useState<ScreenAnalysis>()
  const [selected, setSelected] = useState<number>()
  const [hovered, setHovered] = useState<number>()
  const [analyzing, setAnalyzing] = useState(false)
  const version = useRef({ value: 0 })
  const clear = () => { version.current.value++; setAnalysis(undefined); setSelected(undefined); setHovered(undefined); setAnalyzing(false) }

  useEffect(() => {
    const counter = version.current
    ++counter.value
    setAnalysis(undefined); setSelected(undefined); setHovered(undefined); setAnalyzing(false)
    return () => { ++counter.value }
  }, [preview])

  useEffect(() => {
    if (!analysis || !preview) return
    const timer = setTimeout(() => { setAnalysis(undefined); setSelected(undefined); setHovered(undefined) }, Math.max(0, Date.parse(analysis.expires_at) - Date.now()))
    return () => {
      clearTimeout(timer)
      void gateway.deleteAnalysis(preview, analysis.id).catch(() => console.warn('[termous:workflow] 分析结果清理失败，将由缓存租约回收'))
    }
  }, [analysis, gateway, preview])

  const analyze = () => {
    if (!preview) return
    clear()
    const current = version.current.value
    void perform(async signal => {
      setAnalyzing(true)
      let result: ScreenAnalysis | undefined
      let published = false
      try {
        result = await gateway.analyze(preview, signal)
        const blob = await gateway.analysisImage(preview, result.id, 'original', signal)
        if (!signal.aborted && current === version.current.value) {
          onSnapshot({ metadata: result.metadata, blob }); setAnalysis(result); published = true
        }
      } finally {
        if (current === version.current.value) setAnalyzing(false)
        if (result && !published) void gateway.deleteAnalysis(preview, result.id).catch(() => console.warn('[termous:workflow] 已取消的分析将由缓存租约回收'))
      }
    })
  }
  const download = (kind: 'json' | 'png') => {
    if (!analysis || !preview) return
    const value = analysis
    void perform(async signal => {
      const blob = kind === 'json' ? new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }) : await gateway.analysisImage(preview, value.id, 'annotated', signal)
      if (!signal.aborted) exportAnalysis(blob, `termous-analysis-${value.id}.${kind}`)
    })
  }
  return { analysis, selected, hovered, analyzing, setSelected, setHovered, clear, analyze, download }
}
