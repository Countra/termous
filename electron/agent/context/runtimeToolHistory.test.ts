import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { compactionTestAssistant, compactionTestUser } from '../test-support/runtimeCompactionTestFixture.ts'
import { projectRuntimeToolHistory, runtimeToolName } from './runtimeToolHistory.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { externalToolName, externalToolSource } from '../contracts/toolSources.ts'
import { localToolNames } from '../contracts/toolNames.ts'

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

test('外部历史名称恢复到同一来源命名空间，不经过内置别名规则', () => {
  const name = 'termous.files.read'
  assert.equal(runtimeToolName(`server_a::${name}`), externalToolName(externalToolSource('server_a'), name))
  assert.notEqual(runtimeToolName(`server_a::${name}`), runtimeToolName(name))
  assert.notEqual(runtimeToolName(`server_a::${name}`), runtimeToolName(`server_b::${name}`))
})

test('扩展资源和回执读取入口恢复时保持本地工具名称', () => {
  for (const name of localToolNames) assert.equal(runtimeToolName(name), name)
})
