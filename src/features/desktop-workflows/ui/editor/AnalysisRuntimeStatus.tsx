import { Button } from 'antd'
import { Cpu } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisDevice, analysisPhase, type AIServiceStatus } from '#entities/ai-runtime'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

export function AnalysisRuntimeStatus({ gateway, onError, active = false }: { gateway: WorkflowMediaGateway; onError: (error: unknown) => void; active?: boolean }) {
  const { t } = useTranslation()
  const [service, setService] = useState<AIServiceStatus>()
  const [preparationFailed, setPreparationFailed] = useState(false)
  const requested = useRef<{ instance: string; failed: boolean } | undefined>(undefined)
  const device = analysisDevice({ service })
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
            // 切换预览不会丢弃该实例的请求结果；旧轮询停止后由新轮询读取。
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
  if (!gateway.openRuntimeSettings) return null
  const label = t(device === 'unknown' ? 'settings.aiRuntime.unknown' : device === 'cuda' ? 'settings.aiRuntime.gpu' : 'settings.aiRuntime.cpu')
  const phase = analysisPhase(service)
  const failed = preparationFailed && service?.state === 'idle'
  return <Button size="small" type="text" icon={<Cpu size={14} />} aria-label={label}
    title={t(failed ? 'settings.aiRuntime.preparationFailed' : `settings.aiRuntime.serviceStates.${phase}`)}
    onClick={() => { void gateway.openRuntimeSettings?.().catch(onError) }}>
    {label} · {t(`settings.aiRuntime.serviceShortStates.${failed ? 'failed' : phase}`)}
  </Button>
}
