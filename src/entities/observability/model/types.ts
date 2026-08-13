export type LinuxMonitorStatus = 'warming' | 'ready' | 'paused' | 'failed' | 'unsupported'

export interface LinuxMonitorCPU {
  usage_percent: number
  total_delta: number
  idle_delta: number
  load_average?: LinuxMonitorLoadAverage
  cores: LinuxMonitorCPUCore[]
}

export interface LinuxMonitorCPUCore {
  name: string
  usage_percent: number
}

export interface LinuxMonitorLoadAverage {
  one_minute: number
  five_minutes: number
  fifteen_minutes: number
  running_tasks: number
  total_tasks: number
  latest_pid: number
}

export interface LinuxMonitorMemory {
  total_bytes: number
  available_bytes: number
  used_bytes: number
  used_percent: number
  swap_total_bytes: number
  swap_used_bytes: number
}

export interface LinuxMonitorNetwork {
  name: string
  rx_bytes: number
  tx_bytes: number
  rx_bytes_per_sec: number
  tx_bytes_per_sec: number
  is_loopback: boolean
}

export interface LinuxMonitorDiskIODevice {
  name: string
  read_bytes_per_sec: number
  write_bytes_per_sec: number
  read_iops: number
  write_iops: number
  read_latency_ms: number
  write_latency_ms: number
  busy_percent: number
  in_flight: number
}

export interface LinuxMonitorDiskIO {
  status: LinuxMonitorStatus
  devices: LinuxMonitorDiskIODevice[]
}

export interface LinuxMonitorDisk {
  filesystem: string
  type: string
  mountpoint: string
  total_bytes: number
  used_bytes: number
  available_bytes: number
  used_percent: number
  severity: 'normal' | 'warning' | 'critical'
}

export interface LinuxMonitorSnapshot {
  status: LinuxMonitorStatus
  collected_at: string
  interval_seconds: number
  cpu: LinuxMonitorCPU
  memory: LinuxMonitorMemory
  networks: LinuxMonitorNetwork[]
  disk_io: LinuxMonitorDiskIO
  disks: LinuxMonitorDisk[]
}

export type RemoteProcessSort = 'cpu' | 'memory' | 'pid' | 'name' | 'runtime'

export type RemoteProcessTerminateSignal = 'term' | 'kill'

export interface RemoteProcessQuery {
  query?: string
  pid?: number
  port?: number
  sort?: RemoteProcessSort
  limit?: number
}

export interface RemoteProcessPort {
  protocol: string
  local_address: string
  local_port: number
  pid?: number
  process_name?: string
  raw?: string
}

export interface RemoteProcessSummary {
  pid: number
  ppid: number
  user: string
  state: string
  cpu_percent: number
  memory_percent: number
  rss_bytes: number
  runtime_seconds: number
  name: string
  command_line: string
  listening_ports?: number[]
  warnings?: string[]
  permission_state?: string
}

export interface RemoteProcessListResult {
  items: RemoteProcessSummary[]
  ports: RemoteProcessPort[]
  total: number
  filtered: number
  collected_at: string
  warnings?: string[]
}

export interface RemoteProcessDetail {
  summary: RemoteProcessSummary
  full_command_line?: string
  cwd?: string
  executable?: string
  status?: Record<string, string>
  ports?: RemoteProcessPort[]
  warnings?: string[]
  collected_at: string
}

export interface RemoteProcessTerminateRequest {
  signal: RemoteProcessTerminateSignal
}

export interface RemoteProcessTerminateResult {
  pid: number
  signal: RemoteProcessTerminateSignal
  attempted: boolean
  message: string
}
