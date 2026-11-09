import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import { isWebSearchResult } from '#common/contracts'
import { attachWebSearch } from './webSearch.ts'
import { RuntimeToolDiscovery } from '../tools/runtimeToolDiscovery.ts'
import { toolIdentity } from '../contracts/toolSources.ts'

const context = { tools: { 'termous.web.search': { description: 'Search the web for snippets.', inputSchema: Type.Object({ query: Type.String() }) } } }
const result = { provider: 'searxng', query: 'test', page: 1, retrieved_at: '2026-10-31T00:00:00Z', partial: false, truncated: false, warnings: [], results: [{ title: 'Title', url: 'https://example.test', snippet: 'Reference' }] }

test('搜索独立于本地目录及 MCP 通道，显式发现能加载真实声明', async () => {
  let calls = 0
  const controller = new AbortController()
  const connection = attachWebSearch({ tools: [], originalName: () => null, close: async () => {} }, context, async (input, signal) => {
    calls++; assert.deepEqual(input, { query: 'test' }); assert.equal(signal, controller.signal); return result
  })
  assert.equal(calls, 0)
  const discovery = new RuntimeToolDiscovery(connection.tools, connection.originalName, [])
  await discovery.tool.execute('discover', { names: ['termous.web.search'] })
  assert(discovery.publish().some(tool => connection.originalName(tool.name) === 'termous.web.search'))
  assert.equal(toolIdentity(connection.tools[0]!)?.source.id, 'termous')
  const receipt = await connection.tools[0]!.execute('search', { query: 'test' }, controller.signal)
  assert.equal(calls, 1)
  assert.equal(receipt.content[0]?.type, 'text')
  assert.match(JSON.stringify(receipt), /Reference/u)
})

test('搜索错误保留有限的分类和说明，不伪造成功空结果', async () => {
  const connection = attachWebSearch({ tools: [], originalName: () => null, close: async () => {} }, context,
    async () => ({ error: { code: 'search_timeout', message: 'Search timed out.', details: 'private data excluded' } }))
  const receipt = await connection.tools[0]!.execute('search', { query: 'test' })
  assert.equal(receipt.isError, true)
  assert.match(JSON.stringify(receipt), /Search timed out/u)
  assert.doesNotMatch(JSON.stringify(receipt), /private data/u)
})

test('搜索结构拒绝可执行 URL、无效日期、超量结果和超大投影', () => {
  assert(isWebSearchResult(result))
  assert(!isWebSearchResult({ ...result, results: [{ ...result.results[0], url: 'javascript:alert(1)' }] }))
  assert(!isWebSearchResult({ ...result, retrieved_at: 'invalid' }))
  assert(!isWebSearchResult({ ...result, results: Array(11).fill(result.results[0]) }))
  assert(!isWebSearchResult({ ...result, results: Array(10).fill({ ...result.results[0], snippet: 'x'.repeat(8192) }) }))
})
