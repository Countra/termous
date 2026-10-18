export type DatabaseStartupOperation = 'initialize' | 'adopt' | 'upgrade' | 'prepare'
export type DatabaseStartupRole = 'live' | 'staged' | 'rollback' | 'source'

export interface DatabaseStartupState {
  id?: string
  domain?: 'core' | 'agent' | 'workflows' | 'audit'
  code?: string
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
  databases?: DatabaseStartupState[]
  failure: CoreStartupFailure | null
  startedAt: string | null
  updatedAt: string | null
  coreVersion?: string
  attention: 'slow' | 'unresponsive' | null
}
