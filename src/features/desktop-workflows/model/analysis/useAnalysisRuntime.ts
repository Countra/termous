import { useEffect, useRef, useState } from 'react'
import type { AIServiceStatus } from '#entities/ai-runtime'
import type { WorkflowMediaGateway } from '../workspace/types'

export function useAnalysisRuntime(gateway: WorkflowMediaGateway, active: boolean) {
  const [service, setService] = useState<AIServiceStatus>()
  const [preparationFailed, setPreparationFailed] = useState(false)
  const requested = useRef<{ instance: string; failed: boolean } | undefined>(undefined)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const value = await gateway.runtimeStatus?.()
        if (!alive) return
        setService(value?.service)
        const current = value?.service
        setPreparationFailed(current?.state === 'idle' && requested.current?.instance === current.instance_id && requested.current?.failed === true)
        // 每个 Python 实例只预热一次；独立服务重启后自动准备新实例。
        if (active && current?.state === 'idle' && current.instance_id && requested.current?.instance !== current.instance_id && gateway.warmupRuntime) {
          const attempt = { instance: current.instance_id, failed: false }
          requested.current = attempt
          setPreparationFailed(false)
          try { await gateway.warmupRuntime() }
          catch {
            // 页面隐藏不会丢弃该实例的请求结果；旧轮询停止后由新轮询读取。
            attempt.failed = true
            if (alive) setPreparationFailed(true)
          }
        }
      } catch { if (alive) setService(undefined) }
      if (alive) timer = setTimeout(() => void refresh(), 1500)
    }
    void refresh()
    return () => { alive = false; clearTimeout(timer) }
  }, [gateway, active])
  return { service, preparationFailed }
}
