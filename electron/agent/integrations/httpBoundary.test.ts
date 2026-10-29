import assert from 'node:assert/strict'
import test from 'node:test'
import { IntegrationHTTPBoundary, integrationMessageLimit } from './httpBoundary.ts'

test('无 Content-Length 的 JSON 流也执行大小限制并取消上游', async () => {
  let cancelled = false
  const boundary = new IntegrationHTTPBoundary('https://server.test/mcp', async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(integrationMessageLimit + 1)) },
    cancel() { cancelled = true },
  }), { headers: { 'content-type': 'application/json' } }))
  const response = await boundary.fetch('https://server.test/mcp')
  await assert.rejects(response.text(), /MESSAGE_TOO_LARGE/u)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelled, true)
})

test('不同目标与重定向不会携带配置的请求信息继续派发', async () => {
  let calls = 0
  const boundary = new IntegrationHTTPBoundary('https://server.test/mcp', async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://other.test' } }) })
  await assert.rejects(boundary.fetch('https://other.test/mcp'), /ENDPOINT_VIOLATION/u)
  assert.equal(calls, 0)
  await assert.rejects(boundary.fetch('https://server.test/mcp'), /REDIRECT_REJECTED/u)
  assert.equal(calls, 1)
})
