import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import {
  createRemoteDesktopProfileDraft,
  hasRemoteDesktopProfileDraftErrors,
  normalizeRemoteDesktopProfileDraft,
  remoteDesktopProfileDraftsEqual,
  remoteDesktopProfileToDraft,
  validateRemoteDesktopProfileDraft,
} from './remoteDesktopProfileDraft.ts'

test('创建草稿时使用稳定默认值并隔离嵌套 VNC 配置', () => {
  const first = createRemoteDesktopProfileDraft('hst_first', 'ssh_first')
  const second = createRemoteDesktopProfileDraft('hst_second', 'ssh_second')

  assert.deepEqual(first, {
    name: '',
    description: '',
    host_id: 'hst_first',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh_first',
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

  first.vnc.port = 5901
  assert.equal(second.host_id, 'hst_second')
  assert.equal(second.ssh_profile_id, 'ssh_second')
  assert.equal(second.vnc.port, 5900)
})

test('Profile 投影为独立草稿并固定首期协议与传输方式', () => {
  const source = profile()
  const draft = remoteDesktopProfileToDraft(source)

  assert.deepEqual(draft, {
    name: source.name,
    description: source.description,
    host_id: source.host_id,
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: source.ssh_profile_id,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: source.vnc,
  })

  draft.vnc.port = 5999
  assert.equal(source.vnc.port, 5901)
})

test('规范化时裁剪文本并把空端口投影为无效输入值', () => {
  const draft = createRemoteDesktopProfileDraft('hst_test', 'ssh_test')
  draft.name = '  Production desktop  '
  draft.description = '  Primary VNC viewer  '
  draft.vnc.port = null

  assert.deepEqual(normalizeRemoteDesktopProfileDraft(draft), {
    name: 'Production desktop',
    description: 'Primary VNC viewer',
    host_id: 'hst_test',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh_test',
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 0,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
  })
})

test('校验名称、可用主机和整数端口边界', () => {
  const availableHostIds = new Set(['hst_test'])
  const availableSSHProfileIds = new Set(['ssh_test'])
  const valid = createRemoteDesktopProfileDraft('hst_test', 'ssh_test')
  valid.name = 'Desktop'

  assert.deepEqual(validateRemoteDesktopProfileDraft(
    valid,
    availableHostIds,
    availableSSHProfileIds,
  ), {})

  for (const port of [null, 0, 65_536, 5900.5]) {
    const invalid = createRemoteDesktopProfileDraft('hst_missing', 'ssh_missing')
    invalid.name = '   '
    invalid.vnc.port = port
    const errors = validateRemoteDesktopProfileDraft(
      invalid,
      availableHostIds,
      availableSSHProfileIds,
    )

    assert.deepEqual(errors, {
      name: 'validationName',
      host_id: 'validationHost',
      ssh_profile_id: 'validationHost',
      port: 'validationPort',
    })
    assert.equal(hasRemoteDesktopProfileDraftErrors(errors), true)
  }

  assert.equal(hasRemoteDesktopProfileDraftErrors({}), false)
})

test('草稿相等判断覆盖全部可编辑字段', () => {
  const baseline = remoteDesktopProfileToDraft(profile())
  assert.equal(remoteDesktopProfileDraftsEqual(baseline, remoteDesktopProfileToDraft(profile())), true)

  const variants = [
    { ...baseline, name: 'Renamed desktop' },
    { ...baseline, description: 'Changed description' },
    { ...baseline, host_id: 'hst_other' },
    { ...baseline, ssh_profile_id: 'ssh_other' },
    { ...baseline, vnc: { ...baseline.vnc, loopback_host: '::1' as const } },
    { ...baseline, vnc: { ...baseline.vnc, port: 5902 } },
    { ...baseline, vnc: { ...baseline.vnc, shared: false } },
    { ...baseline, vnc: { ...baseline.vnc, default_view_only: true } },
    { ...baseline, vnc: { ...baseline.vnc, default_display_mode: 'actual' as const } },
  ]

  for (const variant of variants) {
    assert.equal(remoteDesktopProfileDraftsEqual(baseline, variant), false)
  }
})

function profile(): RemoteDesktopAccessProfile {
  return {
    id: 'rdp_test',
    host_id: 'hst_test',
    name: 'Production desktop',
    description: 'Primary viewer',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: 'ssh_test',
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'resize',
    },
    is_default: true,
    sort_order: 0,
    target_auth: null,
    created_at: '2026-08-24T08:00:00Z',
    updated_at: '2026-08-24T08:00:00Z',
  }
}
