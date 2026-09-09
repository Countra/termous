import type { AgentLaunchIntent, AgentLaunchRequest, AgentSourceContext } from './types.ts'

interface LaunchContextCopy {
  title: string
  summary: string
}

interface HostProfileLaunchInput extends LaunchContextCopy {
  hostId: string
  profileKind?: 'ssh' | 'file' | 'remote_desktop'
  profileId?: string
}

interface ForwardFailureLaunchInput extends LaunchContextCopy {
  hostId?: string
  forwardId: string
  forwardProfileId?: string
  status: string
  errorCode?: string
}

export function assignAgentLaunchIntentKey(
  request: AgentLaunchRequest,
  key: number,
): AgentLaunchIntent {
  switch (request.source) {
    case 'connection_reference':
    case 'terminal_selection':
    case 'host_profile':
    case 'forward_failure':
      return { ...request, key }
  }
}

export function buildHostProfileAgentLaunchRequest(input: HostProfileLaunchInput): Extract<AgentLaunchRequest, { source: 'host_profile' }> {
  return {
    source: 'host_profile',
    host_id: input.hostId,
    profile_kind: input.profileKind,
    profile_id: input.profileId,
    source_context: sourceContext(
      'host_profile',
      input.profileId || input.hostId,
      input,
    ),
  }
}

export function buildForwardFailureAgentLaunchRequest(input: ForwardFailureLaunchInput): Extract<AgentLaunchRequest, { source: 'forward_failure' }> {
  return {
    source: 'forward_failure',
    host_id: input.hostId,
    forward_id: input.forwardId,
    forward_profile_id: input.forwardProfileId,
    status: input.status,
    error_code: input.errorCode,
    source_context: sourceContext('forward_failure', input.forwardId, input),
  }
}

function sourceContext(
  kind: AgentSourceContext['kind'],
  entityId: string,
  copy: LaunchContextCopy,
): AgentSourceContext {
  return {
    kind,
    entity_id: entityId,
    title: copy.title,
    summary: copy.summary,
  }
}
