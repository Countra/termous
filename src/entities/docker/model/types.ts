export type DockerCapabilityStatus = 'available' | 'missing_cli' | 'daemon_unavailable' | 'permission_denied' | 'unknown'

export type DockerContainerState = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead' | string

export type DockerHealthStatus = 'healthy' | 'unhealthy' | 'starting' | 'none' | string

export type DockerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause'

export interface DockerCapability {
  available: boolean
  status: DockerCapabilityStatus
  message?: string
  docker_version?: string
  server_version?: string
  context?: string
  warnings?: string[]
  collected_at: string
}

export interface DockerContainerQuery {
  query?: string
  state?: string
  health?: string
  port?: number
  limit?: number
}

export interface DockerContainerPort {
  ip?: string
  public_port?: number
  private_port?: number
  type?: string
  raw?: string
}

export interface DockerContainerStats {
  id?: string
  name?: string
  cpu_percent?: string
  memory?: string
  memory_percent?: string
  net_io?: string
  block_io?: string
  pids?: string
}

export interface DockerContainerSummary {
  id: string
  short_id: string
  name: string
  image: string
  command?: string
  created_at?: string
  running_for?: string
  ports?: DockerContainerPort[]
  raw_ports?: string
  state: DockerContainerState
  status?: string
  health?: DockerHealthStatus
  compose_project?: string
  stats?: DockerContainerStats
  warnings?: string[]
}

export interface DockerContainerMount {
  type?: string
  source?: string
  destination?: string
  mode?: string
  rw: boolean
}

export interface DockerContainerNetwork {
  name: string
  ip_address?: string
  mac_address?: string
  gateway?: string
}

export interface DockerEnvVar {
  key: string
  value?: string
  redacted?: boolean
}

export interface DockerContainerDetail {
  summary: DockerContainerSummary
  mounts?: DockerContainerMount[]
  networks?: DockerContainerNetwork[]
  labels?: Record<string, string>
  env?: DockerEnvVar[]
  restart_policy?: string
  created?: string
  path?: string
  args?: string[]
  stats?: DockerContainerStats
  logs_preview?: string[]
  collected_at: string
  warnings?: string[]
}

export interface DockerListResult {
  items: DockerContainerSummary[]
  total: number
  filtered: number
  collected_at: string
  warnings?: string[]
}

export interface DockerLogsResult {
  lines: string[]
  tail: number
  timestamps: boolean
  collected_at: string
}

export interface DockerActionRequest {
  action: DockerAction
  timeout_seconds?: number
}

export interface DockerActionResult {
  id?: string
  action: DockerAction
  attempted: boolean
  message: string
  completed_at: string
}
