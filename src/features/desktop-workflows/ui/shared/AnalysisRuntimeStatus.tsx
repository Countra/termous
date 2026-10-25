import { Button } from 'antd'
import { Cpu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { analysisDevice, analysisPhase } from '#entities/ai-runtime'
import { useAnalysisRuntime } from '../../model/analysis/useAnalysisRuntime'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

export function AnalysisRuntimeStatus({ gateway, onError, active = false }: { gateway: WorkflowMediaGateway; onError: (error: unknown) => void; active?: boolean }) {
  const state = useAnalysisRuntime(gateway, active)
  return <AnalysisRuntimeStatusView gateway={gateway} onError={onError} state={state} />
}

export function AnalysisRuntimeStatusView({ gateway, onError, state: { service, preparationFailed } }: {
  gateway: WorkflowMediaGateway; onError: (error: unknown) => void; state: ReturnType<typeof useAnalysisRuntime>
}) {
  const { t } = useTranslation()
  const device = analysisDevice({ service })
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
