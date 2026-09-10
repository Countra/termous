export type DatabaseStartupOperation = 'initialize' | 'adopt' | 'upgrade'
export type DatabaseStartupRole = 'live' | 'staged' | 'rollback'

export interface DatabaseStartupState {
  status: 'checking' | 'unchanged' | 'running' | 'completed' | 'failed'
  operation?: DatabaseStartupOperation
  fromVersion?: number
  targetVersion?: number
  confirmedVersion?: number
  startedAt?: string
  completedAt?: string
  role?: DatabaseStartupRole
}

export interface CoreStartupFailure {
  code: string
  message: string
  details?: string
  migrationVersion?: number
  migrationFile?: string
  fromVersion?: number
  targetVersion?: number
  confirmedVersion?: number
  databaseRole?: DatabaseStartupRole
}

export interface CoreStartupSnapshot {
  attemptId: string
  instanceId: string | null
  revision: number
  phase: 'idle' | 'starting' | 'database' | 'services' | 'ready' | 'failed' | 'external'
  database: DatabaseStartupState | null
  failure: CoreStartupFailure | null
  startedAt: string | null
  updatedAt: string | null
  coreVersion?: string
  attention: 'slow' | 'unresponsive' | null
}
