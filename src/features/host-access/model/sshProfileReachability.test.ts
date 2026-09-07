import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostReachability } from '#entities/host'
import {
  decodeSSHProfileReachabilityEvent,
  indexSSHProfileReachability,
  mergeSSHProfileReachabilityEvent,
} from './sshProfileReachability.ts'

function state(profileId: string, status: HostReachability['status']): HostReachability {
  return {
    host_id: 'host-a',
    ssh_profile_id: profileId,
    address: `${profileId}.example.com`,
    status,
    packet_loss: status === 'online' ? 0 : 1,
  }
}

test('SSH Profile 可达性以 Profile ID 建索引，不让同一主机的状态互相覆盖', () => {
  const indexed = indexSSHProfileReachability([
    state('ssh-default', 'online'),
    state('ssh-secondary', 'offline'),
  ])

  assert.equal(indexed['ssh-default']?.status, 'online')
  assert.equal(indexed['ssh-secondary']?.status, 'offline')
})

test('SSH Profile 可达性增量事件只更新对应 Profile，快照事件替换旧状态', () => {
  const current = indexSSHProfileReachability([
    state('ssh-default', 'online'),
    state('ssh-secondary', 'unknown'),
  ])
  const updated = mergeSSHProfileReachabilityEvent(current, {
    type: 'updated',
    state: state('ssh-secondary', 'offline'),
  })
  assert.equal(updated['ssh-default']?.status, 'online')
  assert.equal(updated['ssh-secondary']?.status, 'offline')

  const snapshot = mergeSSHProfileReachabilityEvent(updated, {
    type: 'snapshot',
    items: [state('ssh-default', 'checking')],
  })
  assert.equal(snapshot['ssh-default']?.status, 'checking')
  assert.equal(snapshot['ssh-secondary'], undefined)
})

test('SSH Profile 可达性拒绝无效 JSON 和缺少 Profile 标识的增量事件', () => {
  assert.equal(decodeSSHProfileReachabilityEvent('{invalid'), null)
  assert.equal(decodeSSHProfileReachabilityEvent(JSON.stringify({
    type: 'updated',
    state: { ...state('ssh-a', 'online'), ssh_profile_id: '' },
  })), null)
})
