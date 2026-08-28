import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeMCPToolName, encodeMCPToolName } from './toolNameCodec.ts'

test('MCP Tool 名称编码可逆且不会混淆点号与下划线', () => {
  const names = [
    'termous.hosts.access_profiles.list',
    'termous.sftp.files.name_search.capability',
    'termous.remote_ops.processes.list',
    'termous.value_with_underscore.read',
  ]
  const encoded = names.map(encodeMCPToolName)

  assert.equal(new Set(encoded).size, names.length)
  assert.deepEqual(encoded.map(decodeMCPToolName), names)
  assert.equal(encodeMCPToolName('a_b.c'), 'm_a_ub_dc')
})

test('MCP Tool 名称解码拒绝非本地前缀和未知转义', () => {
  assert.equal(decodeMCPToolName('termous.hosts.list'), null)
  assert.equal(decodeMCPToolName('m_invalid_x'), null)
  assert.equal(decodeMCPToolName('m_'), null)
})

