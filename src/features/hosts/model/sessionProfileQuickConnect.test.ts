import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { buildSessionProfileQuickConnectItems, filterSessionProfileQuickConnectItems } from './sessionProfileQuickConnect.ts'

const hosts = [{ id: 'host-a', name: '生产服务器' }, { id: 'host-b', name: '测试服务器' }]
const ssh: SSHAccessProfile = {
  id: 'ssh-a', host_id: 'host-a', name: '堡垒入口', address: '192.0.2.10', port: 22,
  username: 'root', auth_method: 'password', credential_id: 'credential-a', fingerprint_policy: 'confirm_on_change',
  is_default: true, sort_order: 0, created_at: '', updated_at: '',
}
function file(id: string, hostId?: string, sshProfileId = 'ssh-a'): FileAccessProfile {
  return {
    id, host_id: hostId, name: id, engine: 'sftp', engine_config_version: 1,
    config: { ssh_profile_id: sshProfileId }, is_default: true, sort_order: 0, created_at: '', updated_at: '',
  }
}
function desktop(id: string): RemoteDesktopAccessProfile {
  return {
    id, host_id: 'host-a', name: id, description: '', protocol: 'vnc', protocol_config_version: 1,
    route: 'direct', route_config_version: 1,
    vnc: { target_host: '192.0.2.20', port: 5900, shared: true, default_view_only: false, default_display_mode: 'fit' },
    target_auth: null, is_default: true, sort_order: 0, created_at: '', updated_at: '',
  }
}

test('文件快捷连接枚举同一主机的全部配置及未绑定主机的独立配置', () => {
  const source = [
    file('secondary', 'host-a'), file('primary', 'host-a'),
    { ...file('object-store'), engine: 's3', config: { endpoint: 'https://storage.example', bucket: 'artifacts' } },
  ]
  const items = buildSessionProfileQuickConnectItems({ intent: 'files', profiles: source }, hosts, [ssh])
  assert.deepEqual(items.map((item) => item.profile.profileId), ['object-store', 'primary', 'secondary'])
  assert.ok(items.every((item) => item.unavailableReason === null))
  assert.equal(items[0].host, undefined)
  assert.match(items[0].profile.endpoint, /storage.example/)
  assert.equal(items[1].host?.name, '生产服务器')
  assert.deepEqual(source.map((item) => item.id), ['secondary', 'primary', 'object-store'])
})

test('缺少路由、跨主机路由及被删除主机均不能连接', () => {
  const items = buildSessionProfileQuickConnectItems({ intent: 'files', profiles: [
    file('missing-route', 'host-a', 'missing'), file('wrong-host', 'host-b'), file('missing-host', 'deleted-host'),
  ] }, hosts, [ssh])
  const reasons = Object.fromEntries(items.map((item) => [item.profile.profileId, item.unavailableReason]))
  assert.deepEqual(reasons, { 'missing-host': 'host_missing', 'missing-route': 'route_missing', 'wrong-host': 'route_missing' })
})

test('桌面直连不依赖 SSH，隧道配置严格检查所属主机的路由', () => {
  const items = buildSessionProfileQuickConnectItems({ intent: 'remote_desktop', profiles: [
    desktop('direct'), { ...desktop('tunneled'), route: 'ssh_tunnel', ssh_profile_id: 'missing' },
  ] }, hosts, [])
  assert.equal(items[0].unavailableReason, null)
  assert.equal(items[1].unavailableReason, 'route_missing')
  assert.equal(items[0].profile.technology, 'vnc')
})

test('搜索同时匹配配置名、主机名、协议及路由端点，忽略大小写和首尾空白', () => {
  const items = buildSessionProfileQuickConnectItems({ intent: 'files', profiles: [file('Archive', 'host-a')] }, hosts, [ssh])
  for (const query of ['  ', '生产 archive', 'SFTP 192.0.2.10', '堡垒 root']) {
    assert.equal(filterSessionProfileQuickConnectItems(items, query).length, 1)
  }
  assert.equal(filterSessionProfileQuickConnectItems(items, 'archive 测试服务器').length, 0)
  assert.equal(items.length, 1)
})
