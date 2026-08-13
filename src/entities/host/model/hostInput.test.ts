import assert from 'node:assert/strict'
import test from 'node:test'
import type { Host } from './types.ts'
import { hostToInput } from './hostInput.ts'
import { createBlankHostInput, normalizeHostInput } from './hostManagement.ts'

test('主机输入保留代理关联并规范空白', () => {
  const host: Host = {
    id: 'host-1',
    name: '测试主机',
    platform: 'linux',
    group_id: '',
    address: 'example.internal',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential-1',
    proxy_id: 'proxy-1',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
  }

  assert.equal(hostToInput(host).proxy_id, 'proxy-1')
  assert.equal(normalizeHostInput({
    ...createBlankHostInput(),
    proxy_id: ' proxy-1 ',
  }).proxy_id, 'proxy-1')
  assert.equal(createBlankHostInput().proxy_id, '')
})
