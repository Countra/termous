import assert from 'node:assert/strict'
import test from 'node:test'
import type { Host, HostInput } from './types.ts'
import {
  createBlankHostInput,
  filterHosts,
  groupHosts,
  hostInputsEqual,
  normalizeHostTags,
  validateHostInput,
} from './hostManagement.ts'

function host(id: string, overrides: Partial<Host> = {}): Host {
  return {
    id,
    name: `Host ${id}`,
    platform: 'linux',
    group_id: '',
    address: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential-password',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
    ...overrides,
  }
}

test('主机输入按规范化结果判断相等并校验必填字段', () => {
  const left = createBlankHostInput()
  const right: HostInput = {
    ...left,
    name: '  ',
    address: '  ',
    username: '  ',
    tags: ['  Production  ', 'production', '  East   China  '],
  }

  assert.deepEqual(normalizeHostTags(right.tags), ['Production', 'East China'])
  assert.equal(hostInputsEqual(left, { ...right, tags: [] }), true)
  assert.deepEqual(validateHostInput(right, {
    address: 'address',
    port: 'port',
    username: 'username',
    credentialId: 'credential',
  }), {
    address: 'address',
    username: 'username',
    credentialId: 'credential',
  })
})

test('主机筛选使用 AND 语义并将未知分组归入未分组', () => {
  const groups = [
    { id: 'group-production', name: 'Production', sort_order: 1 },
    { id: 'group-staging', name: 'Staging', sort_order: 0 },
  ]
  const hosts = [
    host('alpha', {
      name: 'Alpha API',
      group_id: 'group-production',
      auth_method: 'private_key',
      tags: ['East China', 'API'],
    }),
    host('beta', {
      name: 'Beta Worker',
      group_id: 'missing-group',
      tags: ['East China'],
    }),
  ]

  const filtered = filterHosts(hosts, groups, 'alpha east', {
    groupId: 'group-production',
    tags: ['api', 'east china'],
    authMethods: ['private_key'],
  })
  assert.deepEqual(filtered.map((item) => item.id), ['alpha'])

  const sections = groupHosts(hosts, groups, 'Ungrouped')
  assert.deepEqual(sections.map((section) => ({
    id: section.id,
    hosts: section.hosts.map((item) => item.id),
  })), [
    { id: '', hosts: ['beta'] },
    { id: 'group-production', hosts: ['alpha'] },
  ])
})
