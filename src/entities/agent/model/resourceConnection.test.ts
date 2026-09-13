import assert from 'node:assert/strict'
import test from 'node:test'
import { isAgentResourceConnectionActive, type AgentResourceConnectionOperation } from '../index.ts'

test('SSH Profile 连接仅在三个进行中状态阻止发送', () => {
  for (const status of ['connecting', 'waiting_host_trust', 'cancelling'] as const) {
    assert.equal(isAgentResourceConnectionActive(operation(status)), true)
  }
  for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
    assert.equal(isAgentResourceConnectionActive(operation(status)), false)
  }
})

function operation(status: AgentResourceConnectionOperation['status']): AgentResourceConnectionOperation {
  return {
    id: 'connection-one',
    instance_id: 'core-one',
    session_id: 'agent-one',
    kind: 'ssh_session',
    client_request_id: 'request-one',
    revision: 1,
    status,
    target: {
      host_id: 'host-one',
      host_name: 'Alpha',
      ssh_profile_id: 'ssh-one',
      profile_name: 'Primary',
      platform: 'linux',
    },
    source_binding: null,
    retryable: false,
    created_at: '2026-09-12T00:00:00Z',
    updated_at: '2026-09-12T00:00:00Z',
  }
}
