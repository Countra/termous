export type CapabilityRole = 'list' | 'inspect' | 'observe' | 'preview' | 'submit' | 'poll' | 'result' | 'mutate' | 'input' | 'cancel' | 'close'

export interface CapabilityStep {
  tools: string[]
  role: CapabilityRole
  next?: string[]
  cleanup?: string[]
  guidance?: string
  evidence?: 'image'
  completion?: { fields: string[]; flag: string; next: string }
  progresses?: { tools: string[]; path: string }
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
  operations: Partial<Record<string, string[]>>
  evidence?: { states?: string[]; volatile?: string[]; settled?: string[] }
  steps: CapabilityStep[]
  cases?: Array<{ tools: string[]; path: string; values?: string[]; exists?: boolean; next: string[]; guidance: string }>
}

export interface CapabilityCatalog {
  version: 1
  operations: Record<string, string>
  capabilities: ToolCapability[]
  skillEntries: Record<string, string[]>
}
