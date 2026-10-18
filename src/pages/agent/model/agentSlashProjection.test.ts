import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentDesktopResourceBinding, AgentSlashCandidateCatalog } from '#entities/agent'
import { projectCurrentAgentSlashCandidates } from './agentSlashProjection.ts'

const catalog: AgentSlashCandidateCatalog = {
  session: {
    ssh: [
      { id: 'one', kind: 'ssh_session', resource_kind: 'ssh', session_id: 'ssh-one', ssh_profile_id: 'profile-one',
        host_id: 'host-one', host_name: '一号', profile_id: 'profile-one', profile_name: '一号', started_at: '2026-09-12T00:00:00Z', status: 'ready', current: false },
      { id: 'two', kind: 'ssh_session', resource_kind: 'ssh', session_id: 'ssh-two', ssh_profile_id: 'profile-two',
        host_id: 'host-two', host_name: '二号', profile_id: 'profile-two', profile_name: '二号', started_at: '2026-09-11T00:00:00Z', status: 'ready', current: false },
    ],
    file: [],
  },
  profile: {
    ssh: [
      { id: 'profile-one', kind: 'ssh_profile', resource_kind: 'ssh', ssh_profile_id: 'profile-one',
        host_id: 'host-one', host_name: '一号', profile_id: 'profile-one', profile_name: '一号', sort_order: 0, status: 'ready', current: false },
      { id: 'profile-two', kind: 'ssh_profile', resource_kind: 'ssh', ssh_profile_id: 'profile-two',
        host_id: 'host-two', host_name: '二号', profile_id: 'profile-two', profile_name: '二号', sort_order: 0, status: 'ready', current: false },
    ],
    file: [],
  },
}

test('按需关联模式不会把当前 SSH 会话误标为 Profile 关联', () => {
  const projected = projectCurrentAgentSlashCandidates(catalog, [{
    kind: 'ssh_session', session_id: 'ssh-two', ssh_profile_id: 'profile-two', host_id: 'host-two',
    host_name: '二号', platform: 'linux', bound_at: '2026-09-12T00:00:00Z',
  }])
  assert.deepEqual(projected.session.ssh.map(({ session_id }) => session_id), ['ssh-two', 'ssh-one'])
  assert.deepEqual(projected.profile.ssh.map(({ ssh_profile_id }) => ssh_profile_id), ['profile-one', 'profile-two'])
  assert.equal(projected.profile.ssh.some(({ current }) => current), false)
  assert.equal(catalog.session.ssh[1]?.current, false)
})

test('立即连接模式把当前 SSH 会话对应的 Profile 标为当前项', () => {
  const projected = projectCurrentAgentSlashCandidates(catalog, [{
    kind: 'ssh_session', session_id: 'ssh-two', ssh_profile_id: 'profile-two', host_id: 'host-two',
    host_name: '二号', platform: 'linux', bound_at: '2026-09-12T00:00:00Z',
  }], true)

  assert.deepEqual(projected.profile.ssh.map(({ ssh_profile_id }) => ssh_profile_id), ['profile-two', 'profile-one'])
  assert.equal(projected.profile.ssh[0]?.current, true)
})

test('仅关联 SSH Profile 时只把对应 Profile 标为当前项', () => {
  const projected = projectCurrentAgentSlashCandidates(catalog, [{
    kind: 'ssh_profile', ssh_profile_id: 'profile-two', ssh_profile_name: '二号', host_id: 'host-two',
    host_name: '二号', platform: 'linux', bound_at: '2026-09-12T00:00:00Z',
  }])

  assert.equal(projected.profile.ssh[0]?.ssh_profile_id, 'profile-two')
  assert.equal(projected.profile.ssh[0]?.current, true)
  assert.equal(projected.session.ssh.some(({ current }) => current), false)
})

test('桌面配置换主机或协议后不误标为当前项，会话同时核验 Profile 与连接代次', () => {
  const profile: AgentDesktopResourceBinding = { kind: 'desktop_profile', desktop_profile_id: 'desktop-profile', desktop_profile_name: '桌面',
    host_id: 'host', host_name: '目标', protocol: 'vnc', bound_at: '2026-10-14T00:00:00Z' }
  const session: AgentDesktopResourceBinding = { ...profile, kind: 'desktop_session', session_id: 'desktop', connection_generation: 2 }
  const candidate = { id: 'desktop-profile', kind: 'desktop_profile' as const, resource_kind: 'desktop' as const, profile_id: 'desktop-profile',
    profile_name: '桌面', host_id: 'host', host_name: '目标', protocol: 'vnc' as const, status: 'ready' as const, current: false }
  const desktopCatalog: AgentSlashCandidateCatalog = {
    ...catalog,
    profile: { ...catalog.profile, desktop: [candidate] },
    session: { ...catalog.session, desktop: [{ ...candidate, kind: 'desktop_session', session_id: 'desktop', connection_generation: 2, started_at: profile.bound_at }] },
  }
  assert.equal(projectCurrentAgentSlashCandidates(desktopCatalog, [profile]).profile.desktop?.[0]?.current, true)
  assert.equal(projectCurrentAgentSlashCandidates(desktopCatalog, [session]).session.desktop?.[0]?.current, true)
  for (const binding of [profile, session]) {
    for (const changes of [{ host_id: 'other' }, { protocol: 'rdp' as const }, { desktop_profile_id: 'other' }]) {
      const result = projectCurrentAgentSlashCandidates(desktopCatalog, [{ ...binding, ...changes }])
      assert.equal(result.profile.desktop?.[0]?.current, false)
      assert.equal(result.session.desktop?.[0]?.current, false)
    }
  }
  assert.equal(projectCurrentAgentSlashCandidates(desktopCatalog, [{ ...session, connection_generation: 3 }]).session.desktop?.[0]?.current, false)
})
