export type CapabilityRole = 'list' | 'inspect' | 'observe' | 'preview' | 'submit' | 'poll' | 'result' | 'mutate' | 'input' | 'cancel' | 'close'
export type CapabilityFailure = 'blocked' | 'uncertain' | 'stale' | 'pending' | 'missing' | 'invalid' | 'unavailable' | 'unknown'
export type CapabilityTarget = 'session' | 'profile' | 'unbound'

export interface CapabilityCase {
  tools: string[]
  path?: string
  values?: string[]
  exists?: boolean
  empty?: boolean
  omittedIsEmpty?: boolean
  errors?: CapabilityFailure[]
  codes?: string[]
  targets?: CapabilityTarget[]
  next: string[]
  guidance: string
}

export interface CapabilityStep {
  tools: string[]
  role: CapabilityRole
  next?: string[]
  recovery?: string[]
  cleanup?: string[]
  guidance?: string
  preparation?: string
  evidence?: 'image'
  completion?: { fields: string[]; flag: string; next: string }
  progresses?: { tools: string[]; path: string; collection?: boolean }
}

export interface ToolCapability {
  id: string
  group: string
  prefix: string
  keywords: string
  purpose: string
  skill: string
  entry: string[]
  recovery: string[]
  missing?: string[]
  bindings?: { session?: string; profile?: string }
  operations: Partial<Record<string, string[]>>
  evidence?: { states?: string[]; volatile?: string[]; settled?: string[]; approvals?: string[] }
  steps: CapabilityStep[]
  cases?: CapabilityCase[]
}

export interface CapabilityCatalog {
  version: 1
  operations: Record<string, string>
  capabilities: ToolCapability[]
  skillEntries: Record<string, string[]>
}
