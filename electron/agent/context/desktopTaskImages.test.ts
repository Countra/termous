import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeContextImages } from './runtimeContextImages.ts'
import { RuntimeImageWorkingSet } from './runtimeImageWorkingSet.ts'
import { desktopTaskMessage, desktopTaskMessageSource, desktopTaskToolResult } from '../contracts/desktopTaskResult.ts'
import { isRuntimeImage } from '../contracts/runtimeResourceImages.ts'
import { runtimeBootstrap } from '../test-support/runtimeBootstrapTestFixture.ts'
import { hydrateRuntimeMessages } from './runtimeMessages.ts'
import { createProviderModel } from '../provider/runtimeProviderAdapter.ts'
import type { ToolResultMessage } from '@earendil-works/pi-ai'

test('异步观察共用图片窗口，检查点保留来源及按需读取的历史引用', () => {
  const registry = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
  const messages = [1, 2, 3, 4].map(index => {
    const receipt = { tool_call_id: `call_${index}`, execution_id: `desktop_execution_${index}`, revision: 4,
      result: { run: { id: `desktop_execution_${index}`, revision: 4, state: 'completed', accepted_actions: 1, steps: [{ index: 0, kind: 'keyboard.key', state: 'accepted', wait_after_ms: 500 }] }, capture_state: 'ready' },
      image: { resource_id: `image_${index}`, kind: 'image' as const, mime_type: 'image/png', sha256: String(index).repeat(64), size_bytes: 10, image: { width: 1, height: 1 } } }
    registry.registerTaskResult(`part_${index}`, receipt)
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.supports_images = true
    bootstrap.messages = [{ id: 'message', role: 'assistant', status: 'completed', sequence: 1, created_at: '', attachments: [],
      parts: [{ id: `part_${index}`, message_id: 'message', sequence: 1, kind: 'task_result', content: { task_result: receipt } }] }]
    const restored = hydrateRuntimeMessages(bootstrap, createProviderModel(bootstrap.model.snapshot))
    assert.equal(restored.length, 1)
    assert.equal(desktopTaskMessageSource(restored[0]!)?.execution_id, receipt.execution_id)
    return desktopTaskMessage(receipt)
  })
  const working = new RuntimeImageWorkingSet(registry)
  const projected = working.project(messages).messages
  assert.equal(projected.reduce((sum, message) => sum + (Array.isArray(message.content) ? message.content.filter(isRuntimeImage).length : 0), 0), 2)
  working.releasePersisted(messages)
  const checkpoint = registry.serialize(messages)
  assert.match(JSON.stringify(checkpoint[0]), /history_image/)
  assert.match(JSON.stringify(checkpoint[3]), /part_4/)
  assert.equal(desktopTaskMessageSource(structuredClone(messages[3]!))?.execution_id, 'desktop_execution_4')
})

test('显式等待的图片同样受最新两张工作集限制，原图继续保留历史引用', () => {
  const registry = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
  const messages: ToolResultMessage[] = [1, 2, 3].map(index => {
    const result = desktopTaskToolResult({ tool_call_id: `execute_${index}`, execution_id: `desktop_execution_${index}`, revision: 4,
      result: { run: { id: `desktop_execution_${index}`, state: 'completed' } },
      image: { resource_id: `image_${index}`, kind: 'image', mime_type: 'image/png', sha256: String(index).repeat(64), size_bytes: 10, image: { width: 1, height: 1 } } })
    const message: ToolResultMessage = { content: result.content, role: 'toolResult', toolName: 'wait_desktop_execution', toolCallId: `wait_${index}`, isError: false, timestamp: index }
    registry.registerToolResult(`part_${index}`, message)
    return message
  })
  const working = new RuntimeImageWorkingSet(registry)
  const projected = working.project(messages).messages
  assert.equal(projected.reduce((count, message) => count + (Array.isArray(message.content) ? message.content.filter(isRuntimeImage).length : 0), 0), 2)
  working.releasePersisted(messages)
  const checkpoint = registry.serialize(messages)
  assert.match(JSON.stringify(checkpoint[0]), /history_image/)
  assert.match(JSON.stringify(checkpoint[2]), /part_3/)
})
