import assert from 'node:assert/strict'
import test from 'node:test'
import {
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
      loopback_host: '127.0.0.1',
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
