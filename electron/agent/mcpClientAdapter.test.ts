import assert from 'node:assert/strict'
import test from 'node:test'
import type { CallToolResult, Tool as MCPTool } from '@modelcontextprotocol/client'
import {
  connectAgentMCP,
  createExactEndpointFetch,
  createSerialToolInvoker,
  mapMCPTools,
} from './mcpClientAdapter.ts'

test('MCP Tool 动态映射名称和错误详情', async () => {
  const definitions = Array.from({ length: 2 }, (_, index): MCPTool => ({
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

  assert.equal(mapped.tools.length, definitions.length)
  assert.equal(mapped.tools[0]?.name, 'm_termous_dtest_u0_drun')
  assert.equal(mapped.originalNames.get('m_termous_dtest_u0_drun'), 'termous.test_0.run')
  const executed = await mapped.tools[0]?.execute('call-1', { value: 1 })
  assert.deepEqual(executed?.content, [{ type: 'text', text: 'done' }])
  assert.equal(
    (executed?.details as { result?: CallToolResult }).result?.isError,
    true,
  )
})

test('MCP 连接使用 SDK 汇总动态分页目录，并可调用最后一页新增工具', async () => {
  const firstPage: MCPTool[] = [{ name: 'termous.hosts.list', inputSchema: { type: 'object', properties: {} } }]
  const secondPage: MCPTool[] = [{ name: 'termous.sftp.files.delete.preview', inputSchema: {
    type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'],
  } }]
  const methods: string[] = []
  const cursors: unknown[] = []
  const connection = await connectAgentMCP({
    coreBaseURL: 'http://127.0.0.1:52000', endpoint: '/mcp',
    bearerToken: 'fixture-token', protocolVersion: '2025-11-25',
    fetch: async (input, init) => {
      const request = new Request(input, init)
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-token')
      if (request.method === 'GET') return new Response(null, { status: 405 })
      if (request.method === 'DELETE') return new Response(null, { status: 200 })
      const rpc = await request.json() as { id?: number; method: string; params?: Record<string, unknown> }
      methods.push(rpc.method)
      if (rpc.id === undefined) return new Response(null, { status: 202 })
      let result: unknown
      if (rpc.method === 'initialize') {
        result = { protocolVersion: '2025-11-25', capabilities: { tools: {} },
          serverInfo: { name: 'termous-fixture', version: '1' } }
      } else if (rpc.method === 'tools/list') {
        cursors.push(rpc.params?.cursor)
        result = rpc.params?.cursor === 'next-page'
          ? { tools: secondPage }
          : { tools: firstPage, nextCursor: 'next-page' }
      } else {
        assert.equal(rpc.method, 'tools/call')
        assert.deepEqual(rpc.params, { name: secondPage[0]!.name, arguments: { paths: ['/fixture.txt'] } })
        result = { content: [{ type: 'text', text: '预览完成' }] }
      }
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
    },
  })
  try {
    assert.equal(connection.tools.length, 2)
    assert.deepEqual(cursors, [undefined, 'next-page'])
    const last = connection.tools[1]!
    assert.equal(connection.originalName(last.name), secondPage[0]!.name)
    const result = await last.execute('fixture-call', { paths: ['/fixture.txt'] })
    assert.deepEqual(result.content, [{ type: 'text', text: '预览完成' }])
    assert.equal(methods.filter((method) => method === 'tools/call').length, 1)
  } finally {
    await connection.close()
  }
})

test('MCP 动态目录读取后续分页时取消会中止 HTTP 且不继续请求', async () => {
  const controller = new AbortController()
  let secondPageSignal: AbortSignal | undefined
  let pageCount = 0
  let notifySecondPage: () => void = () => undefined
  const secondPageStarted = new Promise<void>((resolve) => { notifySecondPage = resolve })
  const connection = connectAgentMCP({
    coreBaseURL: 'http://127.0.0.1:52000', endpoint: '/mcp',
    bearerToken: 'fixture-token', protocolVersion: '2025-11-25', signal: controller.signal,
    fetch: async (input, init) => {
      const request = new Request(input, init)
      if (request.method === 'GET') return new Response(null, { status: 405 })
      const rpc = await request.json() as { id?: number; method: string; params?: Record<string, unknown> }
      if (rpc.id === undefined) return new Response(null, { status: 202 })
      let result: unknown
      if (rpc.method === 'initialize') {
        result = { protocolVersion: '2025-11-25', capabilities: { tools: {} },
          serverInfo: { name: 'termous-fixture', version: '1' } }
      } else {
        assert.equal(rpc.method, 'tools/list')
        pageCount += 1
        if (rpc.params?.cursor === 'next-page') {
          secondPageSignal = request.signal
          return await new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
            notifySecondPage()
          })
        }
        result = { tools: [{ name: 'termous.hosts.list', inputSchema: { type: 'object', properties: {} } }],
          nextCursor: 'next-page' }
      }
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
    },
  })
  const rejected = assert.rejects(connection)
  try {
    await secondPageStarted
    controller.abort()
    await rejected
    assert.equal(secondPageSignal?.aborted, true)
    assert.equal(pageCount, 2)
  } finally {
    controller.abort()
    await rejected
  }
})

for (const count of [76, 81, 94]) {
  test(`MCP 目录包含 ${count} 项工具时均能初始化，不绑定发布版本数量`, () => {
    const definitions = Array.from({ length: count }, (_, index): MCPTool => ({
      name: `termous.test_${index}.run`, inputSchema: { type: 'object', properties: {} },
    }))
    const mapped = mapMCPTools(definitions, async () => ({ content: [] }))
    assert.equal(mapped.tools.length, count)
    assert.equal(mapped.originalNames.size, count)
  })
}

test('MCP 动态目录仍拒绝空列表、重复名称、过长名称和无效参数定义', () => {
  const invoke = async (): Promise<CallToolResult> => ({ content: [] })
  const definition: MCPTool = { name: 'termous.test.run', inputSchema: { type: 'object', properties: {} } }
  assert.throws(() => mapMCPTools([], invoke), /AGENT_MCP_TOOLS_EMPTY/)
  assert.throws(() => mapMCPTools([definition, definition], invoke), /AGENT_MCP_TOOL_NAME_CONFLICT/)
  assert.throws(() => mapMCPTools([{ ...definition, name: `termous.${'a'.repeat(80)}` }], invoke),
    /AGENT_MCP_TOOL_NAME_CONFLICT/)
  assert.throws(() => mapMCPTools([{
    ...definition,
    inputSchema: { type: 'object', properties: { invalid: { type: 'string', pattern: '[' } } },
  }], invoke), /AGENT_MCP_TOOL_SCHEMA_INVALID/)
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
