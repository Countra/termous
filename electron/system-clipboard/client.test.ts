import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import type { AppConfig, SystemClipboardCapabilitiesSnapshot } from '#common/contracts'
import { ClipboardCapabilitiesClient } from './client.ts'

test('单订阅读取快照，断线禁用并自动恢复；旧 Core 响应不能覆盖新实例', { timeout: 12_000 }, async t => {
  let snapshot: SystemClipboardCapabilitiesSnapshot = { schema_version: 1, instance_id: 'one', revision: 1, capabilities: { import_files: { state: 'ready' }, publish_files: { state: 'ready' } } }
  let requests = 0
  let hold = false
  let finish: (() => void) | undefined
  const server = createServer((req, res) => {
    assert.equal(req.headers['x-termous-token'], 'fixture')
    assert.equal(req.url, '/api/v1/system-file-clipboard/capabilities')
    requests++
    const value = JSON.stringify(snapshot)
    const respond = () => { res.setHeader('Content-Type', 'application/json'); res.end(value) }
    if (hold) finish = respond
    else respond()
  })
  const ws = new WebSocketServer({ server, path: '/api/v1/system-file-clipboard/events' })
  let connections = 0
  ws.on('connection', (socket, request) => {
    connections++
    assert.equal(request.headers['x-termous-token'], 'fixture')
    socket.send(JSON.stringify({ type: 'resync', instance_id: snapshot.instance_id, revision: snapshot.revision }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const client = new ClipboardCapabilitiesClient(async () => ({ apiBaseUrl: `http://127.0.0.1:${address.port}`, apiToken: 'fixture' } as AppConfig))
  t.after(() => { client.stop(); for (const socket of ws.clients) socket.terminate(); ws.close(); server.closeAllConnections(); server.close() })
  const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 400 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(predicate(), '等待能力状态超时')
  }
  client.start(); client.start()
  await wait(() => client.state.get().status === 'connected')
  assert.equal(connections, 1)
  assert.equal(requests, 1)
  hold = true
  snapshot = { ...snapshot, revision: 2 }
  for (const socket of ws.clients) socket.send(JSON.stringify({ type: 'changed', instance_id: 'one', revision: 2 }))
  await wait(() => !!finish)
  for (const socket of ws.clients) socket.terminate()
  await wait(() => client.state.get().status === 'disconnected')
  assert.equal(client.state.get().snapshot?.instance_id, 'one')
  hold = false
  snapshot = { ...snapshot, instance_id: 'two', revision: 1 }
  await wait(() => client.state.get().snapshot?.instance_id === 'two')
  finish!()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(client.state.get().snapshot?.instance_id, 'two')
  assert.equal(connections, 2)
})
