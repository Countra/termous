import type { AIRuntimeStatus, AIServiceStatus } from './types'

export function analysisDevice(status?: Pick<AIRuntimeStatus, 'service'>): 'cpu' | 'cuda' | 'unknown' {
  const service = status?.service
  // 设备来自当前服务的环境探测；模型是否已预热单独显示。
  if (!service || !['idle', 'loading', 'warming', 'ready', 'busy'].includes(service.state)) return 'unknown'
  return service.device === 'cpu' || service.device === 'cuda' ? service.device : 'unknown'
}

export function analysisPhase(service?: AIServiceStatus) {
  switch (service?.state) {
    case 'not_started': case 'starting': return 'starting'
    case 'idle': case 'loading': case 'warming': case 'ready': case 'busy':
    case 'disconnected': case 'maintenance': case 'stopping': case 'failed': return service.state
    default: return 'unavailable'
  }
}
