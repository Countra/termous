import { useCallback, useEffect, useState } from 'react'
import type { OCRParameters } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

export function useOCRDefaults(gateway: Pick<WorkflowMediaGateway, 'ocrDefaults'>) {
  const [value,setValue] = useState<OCRParameters>()
  const [error,setError] = useState<unknown>()
  const [revision,refresh] = useState(0)
  useEffect(() => {
    let request: AbortController | undefined
    const read = () => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      setValue(undefined); setError(undefined)
      void gateway.ocrDefaults(controller.signal).then(
        value => { if (!controller.signal.aborted) setValue(value) },
        error => { if (!controller.signal.aborted) setError(error) },
      )
    }
    read(); window.addEventListener('focus',read)
    return () => { request?.abort(); window.removeEventListener('focus',read) }
  },[gateway,revision])
  return {value,error,refresh:useCallback(() => refresh(v => v+1),[])}
}
