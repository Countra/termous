import { Button } from 'antd'
import { Cpu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisDevice } from '#entities/ai-runtime'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

export function AnalysisRuntimeStatus({ gateway, onError }: { gateway: WorkflowMediaGateway; onError: (error: unknown) => void }) {
  const { t } = useTranslation()
  const [device, setDevice] = useState<ReturnType<typeof analysisDevice>>('unknown')
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try { const value = await gateway.runtimeStatus?.(); if (alive) setDevice(analysisDevice(value)) }
      catch { if (alive) setDevice('unknown') }
      if (alive) timer = setTimeout(() => void refresh(), 5000)
    }
    void refresh()
    return () => { alive = false; clearTimeout(timer) }
  }, [gateway])
  if (!gateway.openRuntimeSettings) return null
  return <Button size="small" type="text" icon={<Cpu size={14} />} title={t('settings.aiRuntime.title')}
    onClick={() => { void gateway.openRuntimeSettings?.().catch(onError) }}>
    {t(device === 'unknown' ? 'settings.aiRuntime.unknown' : device === 'cuda' ? 'settings.aiRuntime.gpu' : 'settings.aiRuntime.cpu')}
  </Button>
}
