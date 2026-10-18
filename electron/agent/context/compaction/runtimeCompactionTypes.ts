import type { AgentMessage } from '@earendil-works/pi-agent-core'

export interface RuntimeCompactionCheckpoint {
  summary: string
  retainedTail: AgentMessage[]
  coveredRawLength: number
  tokensBefore: number
  timestamp: number
  details?: Record<string, unknown>
}

export interface RuntimeCompactionSettings {
  reserveTokens: number
  keepRecentTokens: number
}

export interface RuntimeCompactionPreparation {
  messagesToSummarize: AgentMessage[]
  turnPrefixMessages: AgentMessage[]
  retainedTail: AgentMessage[]
  previousSummary?: string
  settings: RuntimeCompactionSettings
}
