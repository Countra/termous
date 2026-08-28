import assert from 'node:assert/strict'
import test from 'node:test'
import type { CallToolResult, Tool as MCPTool } from '@modelcontextprotocol/client'
import {
  createExactEndpointFetch,
  createSerialToolInvoker,
  mapMCPTools,
} from './mcpClientAdapter.ts'

test('MCP Tool 映射固定数量、名称和错误详情', async () => {
  const definitions = Array.from({ length: 76 }, (_, index): MCPTool => ({
    name: `termous.test_${index}.run`,
    description: `tool ${index}`,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
      additionalProperties: false,
    },
  }))
  const result: CallToolResult = {
    content: [{ type: 'text', text: 'done' }],
    isError: true,
  }
  const mapped = mapMCPTools(definitions, async () => result)

  assert.equal(mapped.tools.length, 76)
  assert.equal(mapped.tools[0]?.name, 'm_termous_dtest_u0_drun')
  assert.equal(mapped.originalNames.get('m_termous_dtest_u0_drun'), 'termous.test_0.run')
  const executed = await mapped.tools[0]?.execute('call-1', { value: 1 })
  assert.deepEqual(executed?.content, [{ type: 'text', text: 'done' }])
  assert.equal(
    (executed?.details as { result?: CallToolResult }).result?.isError,
    true,
  )
})

test('MCP Tool 调用严格串行并在执行前响应取消', async () => {
  let active = 0
  let maximumActive = 0
  let calls = 0
  const definition: MCPTool = {
    name: 'termous.test.run',
    inputSchema: { type: 'object', properties: {} },
  }
  const serial = createSerialToolInvoker(async () => {
    calls++
    active++
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    return { content: [{ type: 'text', text: 'ok' }] }
  })

  await Promise.all([
    serial(definition, {}),
    serial(definition, {}),
    serial(definition, {}),
  ])
  assert.equal(calls, 3)
  assert.equal(maximumActive, 1)

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(serial(definition, {}, controller.signal), { name: 'AbortError' })
  assert.equal(calls, 3)
})

test('MCP fetch 仅允许精确端点且禁止重定向', async () => {
  const endpoint = new URL('http://127.0.0.1:52000/mcp')
  let received: RequestInit | undefined
  const controlled = createExactEndpointFetch(
    endpoint,
    async (_input, init) => {
      received = init
      return new Response('{}', { status: 200 })
    },
  )

  await controlled(endpoint, { method: 'POST' })
  assert.equal(received?.redirect, 'manual')
  assert.equal(received?.cache, 'no-store')
  await assert.rejects(
    controlled('http://127.0.0.1:52000/mcp/extra'),
    /AGENT_MCP_ENDPOINT_VIOLATION/,
  )
  await assert.rejects(
    controlled('http://user@127.0.0.1:52000/mcp'),
    /AGENT_MCP_ENDPOINT_VIOLATION/,
  )
})
