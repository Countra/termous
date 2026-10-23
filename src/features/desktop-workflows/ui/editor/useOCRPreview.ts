import { useEffect, useRef, useState } from 'react'
import type { OCRPreview, OCRQuery, Snapshot } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

export function useOCRPreview(gateway: WorkflowMediaGateway, preview: string | undefined, context: string, query: OCRQuery | undefined, onSnapshot: (snapshot: Snapshot) => void) {
  const [value,setValue] = useState<OCRPreview>()
  const request = useRef<AbortController | undefined>(undefined)
  const signature = JSON.stringify(query)
  useEffect(() => { request.current?.abort(); setValue(undefined); return () => request.current?.abort() },[gateway,preview,context,signature])
  return {value,clear:() => { request.current?.abort(); setValue(undefined) },test: async (signal: AbortSignal) => {
    if (!preview || !query) return
    request.current?.abort()
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
