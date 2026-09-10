import type { AgentLaunchIntent, AgentLaunchRequest } from './types.ts'

export function assignAgentLaunchIntentKey(
  request: AgentLaunchRequest,
  key: number,
): AgentLaunchIntent {
  switch (request.source) {
    case 'connection_reference':
    case 'terminal_selection':
      return { ...request, key }
  }
}
