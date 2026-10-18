import assert from 'node:assert/strict'
import test from 'node:test'
import {
  changeRDPAccessProfileRoute,
  changeRemoteDesktopAccessProfileProtocol,
  createRemoteDesktopAccessProfileDraft,
  normalizeRemoteDesktopAccessProfileDraft,
  remoteDesktopAccessProfileDraftsEqual,
  validateRemoteDesktopAccessProfileDraft,
} from './remoteDesktopAccessProfileDraft.ts'

function validRDP() {
  const draft = createRemoteDesktopAccessProfileDraft('', 'rdp')
  assert.equal(draft.protocol, 'rdp')
  return { ...draft, name: 'Windows', rdp: { ...draft.rdp, target_host: '192.0.2.10', username: 'operator' } }
}

test('协议往返切换保留两套独立配置，名称和说明保持同步', () => {
  const original = validRDP()
  const vnc = changeRemoteDesktopAccessProfileProtocol(original, 'vnc')
  assert.notEqual(vnc.protocol, 'rdp')
  if (vnc.protocol === 'rdp') throw new Error('需要 VNC 草稿')
  const edited = { ...vnc, name: 'Desktop', vnc: { ...vnc.vnc, port: 5902, target_host: '192.0.2.20' } }
  const restored = changeRemoteDesktopAccessProfileProtocol(edited, 'rdp')
  assert.equal(restored.protocol, 'rdp')
  assert.deepEqual(restored.rdp, original.rdp)
  assert.equal(restored.name, 'Desktop')
  const back = changeRemoteDesktopAccessProfileProtocol(restored, 'vnc')
  if (back.protocol === 'rdp') throw new Error('需要 VNC 草稿')
  assert.deepEqual(back.vnc, edited.vnc)
  const input = normalizeRemoteDesktopAccessProfileDraft('host', restored)
  assert.equal('protocol_memory' in input, false)
  assert.equal('vnc' in input, false)
  assert.equal(remoteDesktopAccessProfileDraftsEqual(restored, { ...original, name: 'Desktop' }), true)
})

test('RDP 路由切换选择默认 SSH，并分别保留目标和 SSH 选择', () => {
  const direct = validRDP()
  const tunnel = changeRDPAccessProfileRoute(direct, 'ssh_tunnel', 'ssh-primary')
  assert.equal(tunnel.ssh_profile_id, 'ssh-primary')
  const edited = { ...tunnel, ssh_profile_id: 'ssh-backup', rdp: { ...tunnel.rdp, target_host: 'windows.internal' } }
  const restored = changeRDPAccessProfileRoute(edited, 'direct')
  assert.equal(restored.ssh_profile_id, '')
  assert.equal(restored.rdp.target_host, '192.0.2.10')
  const back = changeRDPAccessProfileRoute(restored, 'ssh_tunnel', 'ssh-primary')
  assert.equal(back.ssh_profile_id, 'ssh-backup')
  assert.equal(back.rdp.target_host, 'windows.internal')
  assert.equal('route_memory' in normalizeRemoteDesktopAccessProfileDraft('host', back), false)
  const cleared = { ...restored, rdp: { ...restored.rdp, target_host: '' } }
  assert.equal(changeRDPAccessProfileRoute(changeRDPAccessProfileRoute(cleared, 'ssh_tunnel'), 'direct').rdp.target_host, '')
})

test('RDP 清空数字字段仍是空草稿，阻止提交并分别标记尺寸错误', () => {
  const draft = validRDP()
  assert.deepEqual(validateRemoteDesktopAccessProfileDraft({ ...draft, rdp: { ...draft.rdp, port: null, width: null } }, new Set()), {
    port: 'range', width: 'range',
  })
  assert.deepEqual(validateRemoteDesktopAccessProfileDraft({ ...draft, rdp: { ...draft.rdp, height: 1081 } }, new Set()), { height: 'range' })
  assert.deepEqual(validateRemoteDesktopAccessProfileDraft({ ...draft, rdp: { ...draft.rdp, width: 8192, height: 8192 } }, new Set()), { dimensions: 'range' })
})

test('RDP 校验服务器身份、SSH 引用和账户字节数', () => {
  const draft = validRDP()
  const invalid = { ...draft, route: 'ssh_tunnel' as const, ssh_profile_id: 'missing',
    rdp: { ...draft.rdp, target_host: 'rdp://host:3389', server_name: 'host/path', username: '用'.repeat(86), domain: 'domain\nline' } }
  assert.deepEqual(validateRemoteDesktopAccessProfileDraft(invalid, new Set()), {
    ssh_profile_id: 'missing', target_host: 'invalid', server_name: 'invalid', username: 'invalid', domain: 'invalid',
  })
  const valid = { ...invalid, ssh_profile_id: 'ssh', rdp: { ...draft.rdp, target_host: 'windows.internal', server_name: 'WINDOWS', domain: 'EXAMPLE' } }
  assert.deepEqual(validateRemoteDesktopAccessProfileDraft(valid, new Set(['ssh'])), {})
  assert.deepEqual(validateRemoteDesktopAccessProfileDraft({ ...valid, rdp: { ...valid.rdp, server_name: '123' } }, new Set(['ssh'])), {})
  assert.equal(validateRemoteDesktopAccessProfileDraft({ ...valid, rdp: { ...valid.rdp, server_name: '0.0.0.0' } }, new Set(['ssh'])).server_name, 'invalid')
  assert.deepEqual(validateRemoteDesktopAccessProfileDraft({ ...valid, route: 'direct' }, new Set()), { target_host: 'invalid' })
})

test('默认隧道草稿提供回环目标，服务器名称留空时使用目标', () => {
  const draft = createRemoteDesktopAccessProfileDraft('ssh', 'rdp')
  assert.equal(draft.protocol, 'rdp')
  assert.equal(draft.rdp.target_host, '127.0.0.1')
  const input = normalizeRemoteDesktopAccessProfileDraft('host', draft)
  assert.equal(input.protocol, 'rdp')
  assert.equal(input.rdp.server_name, '127.0.0.1')
})
