import type { AIRuntimeStatus } from './types'

export function analysisDevice(status?: Pick<AIRuntimeStatus, 'service'>): 'cpu' | 'cuda' | 'unknown' {
  const service = status?.service
  // 组件检查只说明环境能力；当前推理设备以已就绪服务报告为准。
  if (!service || !['ready', 'busy'].includes(service.state)) return 'unknown'
  return service.device === 'cpu' || service.device === 'cuda' ? service.device : 'unknown'
}
