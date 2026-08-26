import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { buildHostDirectoryItems } from './hostDirectory.ts'

test('每个主机资产都保留在目录中且只绑定唯一默认 SSH', () => {
  const assets = [asset('asset-only', 'Asset only'), asset('ready', 'Ready')]
  const items = buildHostDirectoryItems(assets, [sshProfile('ready', 'ssh-ready', true)])

  assert.deepEqual(items.map((item) => item.id), ['asset-only', 'ready'])
  assert.equal(items[0]?.defaultSSHProfile, null)
  assert.equal(items[0]?.defaultSSHResolution, 'missing')
  assert.equal(items[1]?.defaultSSHProfile?.id, 'ssh-ready')
  assert.equal(items[1]?.defaultSSHResolution, 'resolved')
})

test('默认项异常时不猜测任意 SSH Profile', () => {
  const items = buildHostDirectoryItems([asset('host', 'Host')], [
    sshProfile('host', 'ssh-a', true),
    sshProfile('host', 'ssh-b', true),
    sshProfile('host', 'ssh-c', false),
  ])

  assert.equal(items[0]?.defaultSSHProfile, null)
  assert.equal(items[0]?.defaultSSHResolution, 'ambiguous')
})

function asset(id: string, name: string): HostAsset {
  return {
    id,
    name,
    platform: 'linux',
    group_id: '',
    tags: [],
    favorite: false,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function sshProfile(hostId: string, id: string, isDefault: boolean): SSHAccessProfile {
  return {
    id,
    host_id: hostId,
    name: id,
    address: '192.0.2.10',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential',
    fingerprint_policy: 'confirm_on_change',
    is_default: isDefault,
    sort_order: 0,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}
