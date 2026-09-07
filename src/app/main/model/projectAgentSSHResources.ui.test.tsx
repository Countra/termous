import { describe, expect, it } from 'vitest'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { projectAgentSSHResources } from './projectAgentSSHResources.ts'

describe('Agent SSH 资源投影', () => {
  it('按会话快照判断可用性且不依赖当前主机与 Profile 记录', () => {
    const resource = projectAgentSSHResources([session()], [], [])[0]
    expect(resource).toMatchObject({
      session_id: 'ses-one',
      host_id: 'host-one',
      ssh_profile_id: 'ssh-one',
      host_name: 'host-one',
      ssh_profile_name: 'ssh-one',
      status: 'ready',
    })
  })

  it('只有 connected 且 ready 的会话可作为重绑候选', () => {
    const hosts = [{ id: 'host-one', name: 'Production', platform: 'linux' }] as Host[]
    const profiles = [{ id: 'ssh-one', name: 'Primary' }] as SSHAccessProfile[]
    expect(projectAgentSSHResources([
      session(),
      session({ id: 'ses-connecting', phase: 'dialing' }),
      session({ id: 'ses-failed', status: 'failed', phase: 'failed' }),
    ], hosts, profiles).map(({ status }) => status)).toEqual([
      'ready', 'unavailable', 'unavailable',
    ])
  })

  it('不把后端无法绑定的非 Linux SSH 会话投影为候选资源', () => {
    const hosts = [{
      id: 'host-one',
      name: 'Windows',
      platform: 'windows',
    }] as unknown as Host[]
    expect(projectAgentSSHResources(
      [session()],
      hosts,
      [{ id: 'ssh-one', name: 'Primary' }] as SSHAccessProfile[],
    )).toEqual([])
  })
})

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses-one',
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-one',
    ssh_profile_id: 'ssh-one',
    status: 'connected',
    phase: 'ready',
    started_at: '2026-08-31T08:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
    ...overrides,
  }
}
