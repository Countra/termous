import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { compactionTestAssistant, compactionTestUser } from './runtimeCompactionTestFixture.ts'
import { projectRuntimeToolHistory, runtimeToolName } from './runtimeToolHistory.ts'
import { encodeMCPToolName } from './toolNameCodec.ts'

test('历史原名与已编码名先解码再映射，重复恢复不会二次编码', () => {
  const expected = encodeMCPToolName('termous.files.batch_rename.presets.list')
  for (const source of ['termous.sftp.files.batch_rename.presets.list', expected,
    encodeMCPToolName('termous.sftp.files.batch_rename.presets.list')]) {
    assert.equal(runtimeToolName(source), expected)
    assert.equal(runtimeToolName(runtimeToolName(source)), expected)
  }
  assert.equal(runtimeToolName('read_skill_resource'), 'read_skill_resource')
  assert.equal(runtimeToolName('termous.hosts.list'), encodeMCPToolName('termous.hosts.list'))
})

test('压缩尾部仅投影结构化工具名称，保留调用配对、正文、参数与原快照', () => {
  const legacy = 'termous.sftp.files.read_text'
  const assistant = {
    ...compactionTestAssistant(legacy),
    content: [...compactionTestAssistant(legacy).content,
      { type: 'toolCall' as const, id: 'call-old', name: encodeMCPToolName(legacy), arguments: { path: legacy } }],
  }
  const result: ToolResultMessage = {
    role: 'toolResult', toolCallId: 'call-old', toolName: legacy,
    content: [{ type: 'text', text: legacy }], isError: false, timestamp: 3,
  }
  const snapshot = structuredClone([assistant, result])
  const nextAssistant = projectRuntimeToolHistory(assistant)
  const nextResult = projectRuntimeToolHistory(result)
  assert.deepEqual([assistant, result], snapshot)
  assert.equal(nextAssistant.role === 'assistant' && nextAssistant.content[1]?.type === 'toolCall'
    && nextAssistant.content[1].name, encodeMCPToolName('termous.files.read_text'))
  assert.equal(nextResult.role === 'toolResult' && nextResult.toolName, encodeMCPToolName('termous.files.read_text'))
  assert.deepEqual(nextResult.role === 'toolResult' && nextResult.content, result.content)
  assert.equal(nextResult.role === 'toolResult' && nextResult.toolCallId, 'call-old')
  assert.equal(nextAssistant.role === 'assistant' && nextAssistant.content[0], assistant.content[0])
  assert.equal(nextAssistant.role === 'assistant' && nextAssistant.content[1]?.type === 'toolCall'
    && nextAssistant.content[1].arguments, assistant.content[1]?.type === 'toolCall' && assistant.content[1].arguments)
  assert.equal(projectRuntimeToolHistory(nextAssistant), nextAssistant)
  const user = compactionTestUser(legacy)
  assert.equal(projectRuntimeToolHistory(user), user)
  const other = { ...result, toolName: 'read_skill_resource' }
  assert.equal(projectRuntimeToolHistory(other), other)
})
