import { useEffect, useState } from 'react'
import type { HostDesktopSource } from '#common/contracts'
import type { WorkflowGateway } from '#entities/desktop-workflow'

export function useWorkflowHostSources(gateway: WorkflowGateway, active: boolean) {
  const [sources, setSources] = useState<HostDesktopSource[]>([])
  useEffect(() => {
    if (!active || !gateway.hostSources) { setSources([]); return }
    const controller = new AbortController()
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try {
        const next = await gateway.hostSources!(controller.signal)
        if (!controller.signal.aborted) setSources(next)
      } catch { if (!controller.signal.aborted) setSources([]) }
      finally { reading = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [gateway, active])
  return sources
}
