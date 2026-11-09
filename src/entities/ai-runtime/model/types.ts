export interface AIRuntimeTask {
  id: string
  phase: 'preflight' | 'downloading' | 'waiting' | 'preparing' | 'installing' | 'checking' | 'complete' | 'failed' | 'cancelled'
  downloaded: number
  total: number
  cancellable: boolean
  error?: string
}
export interface AIServiceStatus {
  state: string
  device?: string
  error?: string
  instance_id?: string
  device_name?: string
  torch_variant?: 'cpu' | 'cuda'
  cuda_available?: boolean
}
export interface AIRuntimeStatus {
  capabilities: { gpu_install: boolean; gpu_check: boolean }
  managed: boolean
  state: 'development' | 'unavailable' | 'incomplete' | 'complete'
  profile: 'cpu' | 'cuda' | ''
  download_size: number
  device: { name: string; driver: number; eligible: boolean; reason?: string }
  check?: { cpu_available: boolean; gpu_available: boolean; device: string; error?: string }
  task?: AIRuntimeTask
  error?: string
  service?: AIServiceStatus
}
export interface AIRuntimeGateway {
  serviceStatus(signal?: AbortSignal): Promise<AIServiceStatus>
  warmup(): Promise<void>
  status(signal?: AbortSignal): Promise<AIRuntimeStatus>
  download(): Promise<AIRuntimeTask>
  cancel(id: string): Promise<void>
  check(): Promise<AIRuntimeTask>
}
