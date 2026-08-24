import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDesktopProfile } from '#entities/remote-desktop'
import {
  createRemoteDesktopProfileDraft,
  hasRemoteDesktopProfileDraftErrors,
  normalizeRemoteDesktopProfileDraft,
  remoteDesktopProfileDraftsEqual,
  remoteDesktopProfileToDraft,
  validateRemoteDesktopProfileDraft,
} from './remoteDesktopProfileDraft.ts'

test('创建草稿时使用稳定默认值并隔离嵌套 VNC 配置', () => {
  const first = createRemoteDesktopProfileDraft('hst_first')
  const second = createRemoteDesktopProfileDraft('hst_second')

  assert.deepEqual(first, {
    name: '',
    description: '',
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: 'hst_first',
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
  })

  first.vnc.port = 5901
  assert.equal(second.ssh_host_id, 'hst_second')
  assert.equal(second.vnc.port, 5900)
})

test('Profile 投影为独立草稿并固定首期协议与传输方式', () => {
  const source = profile()
  const draft = remoteDesktopProfileToDraft(source)

  assert.deepEqual(draft, {
    name: source.name,
    description: source.description,
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: source.ssh_host_id,
    vnc: source.vnc,
  })

  draft.vnc.port = 5999
  assert.equal(source.vnc.port, 5901)
})

test('规范化时裁剪文本并把空端口投影为无效输入值', () => {
  const draft = createRemoteDesktopProfileDraft('hst_test')
  draft.name = '  Production desktop  '
  draft.description = '  Primary VNC viewer  '
  draft.vnc.port = null

  assert.deepEqual(normalizeRemoteDesktopProfileDraft(draft), {
    name: 'Production desktop',
    description: 'Primary VNC viewer',
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: 'hst_test',
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
  const valid = createRemoteDesktopProfileDraft('hst_test')
  valid.name = 'Desktop'

  assert.deepEqual(validateRemoteDesktopProfileDraft(valid, availableHostIds), {})

  for (const port of [null, 0, 65_536, 5900.5]) {
    const invalid = createRemoteDesktopProfileDraft('hst_missing')
    invalid.name = '   '
    invalid.vnc.port = port
    const errors = validateRemoteDesktopProfileDraft(invalid, availableHostIds)

    assert.deepEqual(errors, {
      name: 'validationName',
      ssh_host_id: 'validationHost',
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
    { ...baseline, ssh_host_id: 'hst_other' },
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

function profile(): RemoteDesktopProfile {
  return {
    id: 'rdp_test',
    name: 'Production desktop',
    description: 'Primary viewer',
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: 'hst_test',
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'resize',
    },
    created_at: '2026-08-24T08:00:00Z',
    updated_at: '2026-08-24T08:00:00Z',
  }
}
