import type { AgentLaunchIntent, AgentLaunchRequest, AgentSourceContext } from './types.ts'

interface LaunchContextCopy {
  title: string
  summary: string
}

interface WorkbenchLaunchInput extends LaunchContextCopy {
  sessionId: string
  hostId: string
  sshProfileId: string
  connectionStatus: string
}

interface FilesLaunchInput extends LaunchContextCopy {
  hostId: string
  fileAccessProfileId?: string
  connectionStatus: string
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
    case 'workbench':
    case 'files':
    case 'host_profile':
    case 'forward_failure':
      return { ...request, key }
  }
}

export function buildWorkbenchAgentLaunchRequest(input: WorkbenchLaunchInput): AgentLaunchRequest {
  return {
    source: 'workbench',
    host_id: input.hostId,
    ssh_profile_id: input.sshProfileId,
    connection_status: input.connectionStatus,
    resource_reference: { kind: 'ssh_session', session_id: input.sessionId },
    source_context: sourceContext('workbench', input.sshProfileId, input),
  }
}

export function buildFilesAgentLaunchRequest(input: FilesLaunchInput): AgentLaunchRequest {
  return {
    source: 'files',
    host_id: input.hostId,
    file_access_profile_id: input.fileAccessProfileId,
    connection_status: input.connectionStatus,
    source_context: sourceContext(
      'files',
      input.fileAccessProfileId || input.hostId,
      input,
    ),
  }
}

export function buildHostProfileAgentLaunchRequest(input: HostProfileLaunchInput): AgentLaunchRequest {
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

export function buildForwardFailureAgentLaunchRequest(input: ForwardFailureLaunchInput): AgentLaunchRequest {
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
