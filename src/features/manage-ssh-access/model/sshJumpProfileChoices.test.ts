import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostGroup } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  buildSSHJumpProfileChoices,
  formatSSHJumpEndpoint,
} from './sshJumpProfileChoices.ts'

const groups: HostGroup[] = [
  { id: 'grp-production', name: '生产环境', sort_order: 0 },
]

const hosts: HostAsset[] = [
  host('host-b', '北京节点', 'grp-production'),
  host('host-a', '阿里云香港', ''),
]

test('跳板候选按当前语言、主机和默认配置稳定排序', () => {
  const profiles = [
    profile('ssh-a-secondary', 'host-a', '备用 SSH', false, 1),
    profile('ssh-b-default', 'host-b', '生产 SSH', true, 0),
    profile('ssh-a-default', 'host-a', '公网 SSH', true, 2),
  ]
  const choices = buildSSHJumpProfileChoices({
    profiles,
    hosts,
    groups,
    language: 'zh-CN',
  })

  assert.deepEqual(
    choices.map((choice) => choice.profile.id),
    ['ssh-a-default', 'ssh-a-secondary', 'ssh-b-default'],
  )
  assert.equal(choices.find((choice) => choice.profile.id === 'ssh-b-default')?.groupName, '生产环境')
  assert.equal(choices.find((choice) => choice.profile.id === 'ssh-a-default')?.groupName, undefined)

  const englishChoices = buildSSHJumpProfileChoices({
    profiles,
    hosts,
    groups,
    language: 'en-US',
  })
  assert.deepEqual(
    englishChoices.map((choice) => choice.profile.id),
    ['ssh-b-default', 'ssh-a-default', 'ssh-a-secondary'],
  )
})

test('搜索投影覆盖主机、分组、配置和端点', () => {
  const [choice] = buildSSHJumpProfileChoices({
    profiles: [profile('ssh-b-default', 'host-b', '生产 SSH', true, 0)],
    hosts,
    groups,
    language: 'zh-CN',
  })

  assert.ok(choice)
  assert.match(choice.searchText, /北京节点/)
  assert.match(choice.searchText, /生产环境/)
  assert.match(choice.searchText, /生产 ssh/)
  assert.match(choice.searchText, /root@ssh-b-default\.example\.com:22/)
})

test('IPv6 端点使用方括号且缺失资产不会丢弃配置', () => {
  const orphan = profile('ssh-orphan', 'host-missing', '灾备 SSH', true, 0)
  orphan.address = '2001:db8::8'
  orphan.port = 2202
  orphan.username = 'ops'
  const [choice] = buildSSHJumpProfileChoices({
    profiles: [orphan],
    hosts,
    groups,
    language: 'zh-CN',
  })

  assert.equal(formatSSHJumpEndpoint(orphan), 'ops@[2001:db8::8]:2202')
  assert.equal(choice?.host, undefined)
  assert.equal(choice?.endpoint, 'ops@[2001:db8::8]:2202')
})

test('排除当前配置并标记多级跳板和被引用路由限制', () => {
  const nested = profile('ssh-nested', 'host-a', '级联 SSH', false, 1)
  nested.jump_ssh_profile_id = 'ssh-upstream'
  const consumer = profile('ssh-consumer', 'host-b', '消费者', false, 2)
  consumer.jump_ssh_profile_id = 'ssh-current'

  const choices = buildSSHJumpProfileChoices({
    profiles: [profile('ssh-current', 'host-a', '当前 SSH', true, 0), nested, consumer],
    hosts,
    groups,
    language: 'zh-CN',
    editingProfileId: 'ssh-current',
  })

  assert.deepEqual(choices.map((choice) => choice.profile.id), ['ssh-nested', 'ssh-consumer'])
  assert.ok(choices.every((choice) => choice.availability === 'consumer_route_locked'))

  const nestedOnly = buildSSHJumpProfileChoices({
    profiles: [nested],
    hosts,
    groups,
    language: 'zh-CN',
  })
  assert.equal(nestedOnly[0]?.availability, 'nested_jump')
})

test('主机引用未知分组时保留显式缺失状态', () => {
  const missingGroupHost = host('host-c', '未知目录主机', 'grp-missing')
  const [choice] = buildSSHJumpProfileChoices({
    profiles: [profile('ssh-c', 'host-c', '默认 SSH', true, 0)],
    hosts: [missingGroupHost],
    groups,
    language: 'zh-CN',
  })

  assert.equal(choice?.groupName, undefined)
  assert.equal(choice?.groupMissing, true)
})

function host(id: string, name: string, groupId: string): HostAsset {
  return {
    id,
    name,
    platform: 'linux',
    group_id: groupId,
    tags: [],
    favorite: false,
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  }
}

function profile(
  id: string,
  hostId: string,
  name: string,
  isDefault: boolean,
  sortOrder: number,
): SSHAccessProfile {
  return {
    id,
    host_id: hostId,
    name,
    address: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'private_key',
    credential_id: 'credential-key',
    fingerprint_policy: 'confirm_on_change',
    is_default: isDefault,
    sort_order: sortOrder,
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  }
}
