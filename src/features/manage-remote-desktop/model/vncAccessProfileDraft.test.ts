import assert from 'node:assert/strict'
import test from 'node:test'
import {
  changeVNCAccessProfileRoute,
  createVNCAccessProfileDraft,
  normalizeVNCAccessProfileDraft,
  validateVNCAccessProfileDraft,
  vncAccessProfileDraftsEqual,
} from './vncAccessProfileDraft.ts'

test('VNC 访问配置草稿只接受同目录提供的精确 SSH Profile ID', () => {
  const draft = createVNCAccessProfileDraft('ssh-missing')
  assert.deepEqual(validateVNCAccessProfileDraft(draft, new Set(['ssh-primary'])), {
    name: 'required',
    ssh_profile_id: 'missing',
  })

  const valid = { ...draft, name: 'Desktop', ssh_profile_id: 'ssh-primary' }
  assert.deepEqual(validateVNCAccessProfileDraft(valid, new Set(['ssh-primary'])), {})
  assert.deepEqual(normalizeVNCAccessProfileDraft('host-a', valid), {
    host_id: 'host-a',
    name: 'Desktop',
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh-primary',
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      target_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
  })
})

test('VNC 草稿按提交语义比较并忽略可规范化的首尾空白', () => {
  const baseline = {
    ...createVNCAccessProfileDraft('ssh-primary'),
    name: 'Desktop',
    description: 'Production desktop',
  }
  assert.equal(vncAccessProfileDraftsEqual(baseline, {
    ...baseline,
    name: ' Desktop ',
    description: ' Production desktop ',
    ssh_profile_id: ' ssh-primary ',
  }), true)
})

test('VNC 直连草稿清除 SSH 依赖并规范化目标 IP', () => {
  const direct = changeVNCAccessProfileRoute(
    { ...createVNCAccessProfileDraft('ssh-primary'), name: 'Direct desktop' },
    'direct',
  )
  assert.equal(direct.ssh_profile_id, '')
  assert.equal(direct.vnc.target_host, '')
  assert.deepEqual(validateVNCAccessProfileDraft(direct, new Set(['ssh-primary'])), {
    target_host: 'required',
  })

  const valid = {
    ...direct,
    vnc: { ...direct.vnc, target_host: ' 2001:0DB8:0:0:0:0:0:10 ' },
  }
  assert.deepEqual(validateVNCAccessProfileDraft(valid, new Set()), {})
  const input = normalizeVNCAccessProfileDraft('host-a', valid)
  assert.equal(input.route, 'direct')
  assert.equal('ssh_profile_id' in input, false)
  assert.equal(input.vnc.target_host, '2001:db8::10')

  const tunneled = changeVNCAccessProfileRoute(direct, 'ssh_tunnel', 'ssh-default')
  assert.equal(tunneled.ssh_profile_id, 'ssh-primary')
  assert.equal(tunneled.vnc.target_host, '127.0.0.1')
})

test('VNC 草稿切换连接方式时保留未激活路由的输入且不提交记忆值', () => {
  const initial = {
    ...createVNCAccessProfileDraft('ssh-primary'),
    name: 'Desktop',
    ssh_profile_id: 'ssh-backup',
  }
  const direct = changeVNCAccessProfileRoute(initial, 'direct')
  const directWithTarget = {
    ...direct,
    vnc: { ...direct.vnc, target_host: '192.0.2.10' },
  }
  const tunneled = changeVNCAccessProfileRoute(directWithTarget, 'ssh_tunnel', 'ssh-primary')
  const restoredDirect = changeVNCAccessProfileRoute(tunneled, 'direct')

  assert.equal(tunneled.ssh_profile_id, 'ssh-backup')
  assert.equal(restoredDirect.vnc.target_host, '192.0.2.10')
  assert.equal(restoredDirect.ssh_profile_id, '')
  assert.equal('route_memory' in normalizeVNCAccessProfileDraft('host-a', restoredDirect), false)
  assert.equal(vncAccessProfileDraftsEqual(restoredDirect, {
    ...restoredDirect,
    route_memory: undefined,
  }), true)
})

test('VNC 直连草稿拒绝主机名、URL 和不可连接地址', () => {
  for (const targetHost of ['vnc.example.com', 'https://192.0.2.10', '0.0.0.0', 'ff02::1']) {
    const draft = {
      ...createVNCAccessProfileDraft(),
      name: 'Direct desktop',
      vnc: { ...createVNCAccessProfileDraft().vnc, target_host: targetHost },
    }
    assert.deepEqual(validateVNCAccessProfileDraft(draft, new Set()), { target_host: 'invalid' })
  }
})
