import { AgentQuery_Kind as Q } from '@termous/remote-protocol/agent'
import type { AgentSSHResourceState, AgentFileResourceState, AgentSlashCandidateCatalog } from '#entities/agent'
import { decodeAgentResourceBinding } from '#features/agent-runtime'
import { RemoteError } from '#entities/remote-control'
import { RemoteAgentTransport, object } from './agentTransport.ts'

export interface RemoteAgentResources {
  ssh: AgentSSHResourceState[]
  files: AgentFileResourceState[]
  catalog: AgentSlashCandidateCatalog
}
export const emptyAgentResources = (): RemoteAgentResources => ({ ssh: [], files: [], catalog: { session: { ssh: [], file: [] }, profile: { ssh: [], file: [] } } })

export async function loadAgentResources(t: RemoteAgentTransport, signal: AbortSignal) {
  const result = emptyAgentResources()
  let cursor = ''
  for (let page = 0; page < 400; page++) {
    const value = object(await t.query('resources', Q.RESOURCES, { cursor, limit: 100 }, signal))
    if (!Array.isArray(value.items) || value.items.length > 100) throw new RemoteError('remote_invalid')
    for (const raw of value.items) {
      const candidate = object(raw)
      const binding = decodeAgentResourceBinding(candidate.binding)
      if (typeof candidate.name !== 'string') throw new RemoteError('remote_invalid')
      const common = { host_id: binding.host_id ?? '', host_name: binding.host_name ?? '', current: false, status: 'ready' as const }
      if (binding.kind === 'ssh_session') {
        if (typeof candidate.started_at !== 'string' || !Number.isFinite(Date.parse(candidate.started_at))) throw new RemoteError('remote_invalid')
        const resource = { ...common, session_id: binding.session_id, ssh_profile_id: binding.ssh_profile_id, ssh_profile_name: candidate.name, started_at: candidate.started_at }
        result.ssh.push(resource)
        result.catalog.session.ssh.push({ ...resource, kind: 'ssh_session', resource_kind: 'ssh', id: binding.session_id, profile_id: binding.ssh_profile_id, profile_name: candidate.name })
      } else if (binding.kind === 'ssh_profile') {
        result.catalog.profile.ssh.push({ ...common, id: binding.ssh_profile_id, kind: 'ssh_profile', resource_kind: 'ssh', ssh_profile_id: binding.ssh_profile_id, profile_id: binding.ssh_profile_id, profile_name: binding.ssh_profile_name, sort_order: result.catalog.profile.ssh.length })
      } else {
        result.files.push({ ...common, file_access_profile_id: binding.file_access_profile_id, file_access_profile_name: binding.file_access_profile_name, ssh_profile_id: binding.ssh_profile_id, engine: binding.engine })
        result.catalog.profile.file.push({ ...common, id: binding.file_access_profile_id, kind: 'file_profile', resource_kind: 'file', file_access_profile_id: binding.file_access_profile_id, profile_id: binding.file_access_profile_id, profile_name: binding.file_access_profile_name, sort_order: result.catalog.profile.file.length })
      }
    }
    if (!value.next_cursor) return result
    if (typeof value.next_cursor !== 'string' || value.next_cursor <= cursor) throw new RemoteError('remote_invalid')
    cursor = value.next_cursor
  }
  throw new RemoteError('remote_capacity_exceeded')
}
