import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { RemoteCore, result } from './core.ts'

test('本机写请求丢失回执保留结果不明，不自动重放', async t => {
  const calls: string[] = []
  const server = createServer((request, response) => {
    calls.push(request.method!)
    if (request.url?.endsWith('/rejected')) {
      response.writeHead(409, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'REMOTE_POLICY_CHANGED' } }))
    } else request.socket.destroy()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const core = new RemoteCore(async () => ({ apiBaseUrl: `http://127.0.0.1:${address.port}`, apiToken: 'isolated-test-token' }))
  assert.deepEqual(await result(() => core.request('/remote-control/request', { action: 'close' })), {
    ok: false, code: 'remote_request_failed', uncertain: true,
  })
  assert.deepEqual(await result(() => core.request('/remote-control/connection')), {
    ok: false, code: 'remote_request_failed', uncertain: false,
  })
  assert.deepEqual(await result(() => core.request('/remote-control/rejected', {}, 'PUT')), {
    ok: false, code: 'remote_policy_changed', uncertain: false,
  })
  assert.deepEqual(calls, ['POST', 'GET', 'PUT'])
})
