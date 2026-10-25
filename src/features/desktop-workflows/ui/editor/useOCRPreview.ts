import { useEffect, useRef, useState } from 'react'
import type { OCRPreview, OCRQuery, Snapshot } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

export function useOCRPreview(gateway: WorkflowMediaGateway, preview: string | undefined, context: string, query: OCRQuery | undefined, onSnapshot: (snapshot: Snapshot) => void) {
  const [value,setValue] = useState<OCRPreview>()
  const request = useRef<AbortController | undefined>(undefined)
  const retained = useRef<{ gateway: WorkflowMediaGateway; preview: string | undefined; context: string; signature: string } | undefined>(undefined)
  const signature = JSON.stringify(query)
  useEffect(() => {
    request.current?.abort()
    const keep = retained.current
    retained.current = undefined
    // 仅本次结果填入的文字可保留观察；其他条件或上下文变化仍使旧结果失效。
    if (!keep || keep.gateway !== gateway || keep.preview !== preview || keep.context !== context || keep.signature !== signature) setValue(undefined)
    return () => request.current?.abort()
  },[gateway,preview,context,signature])
  return {value, retainText: (text: string) => {
    if (!value || !query) return
    retained.current = { gateway, preview, context, signature: JSON.stringify({ ...query, text }) }
  },test: async (signal: AbortSignal) => {
    if (!preview || !query) return
    request.current?.abort()
    retained.current = undefined
    const controller = new AbortController(); request.current = controller
    const abort = () => controller.abort()
    signal.addEventListener('abort',abort,{once:true})
    try {
      signal.throwIfAborted()
      const result = await gateway.previewOCR(preview,query,controller.signal)
      if (!signal.aborted && !controller.signal.aborted) { setValue(result); onSnapshot({metadata:result.capture.metadata,blob:result.image}) }
    } catch (error) { if (!controller.signal.aborted && !signal.aborted) throw error }
    finally { signal.removeEventListener('abort',abort) }
  }}
}
