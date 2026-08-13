import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isValidMcpClientName,
  maximumMcpClientNameBytes,
  mcpClientNameBytes,
} from './mcpClientName.ts'

test('MCP 客户端名称按 UTF-8 字节而不是字符数限制', () => {
  assert.equal(mcpClientNameBytes('a'.repeat(maximumMcpClientNameBytes)), 80)
  assert.equal(isValidMcpClientName('a'.repeat(80)), true)
  assert.equal(isValidMcpClientName('a'.repeat(81)), false)
  assert.equal(mcpClientNameBytes('中'.repeat(27)), 81)
  assert.equal(isValidMcpClientName('中'.repeat(26)), true)
  assert.equal(isValidMcpClientName('中'.repeat(27)), false)
  assert.equal(mcpClientNameBytes('😀'.repeat(20)), 80)
  assert.equal(isValidMcpClientName('😀'.repeat(20)), true)
  assert.equal(isValidMcpClientName('😀'.repeat(21)), false)
  assert.equal(isValidMcpClientName('   '), false)
})
