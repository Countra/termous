import assert from 'node:assert/strict'
import test from 'node:test'
import type { DetachedPacket } from '#common/contracts'
import { DetachedRequestPeer } from './requestPeer.ts'

const connection = { module: 'test-module', instance: 'one', generation: 'generation-1' }

test('连接释放后不执行已经入队但尚未开始的业务，已开始的任务允许自然完成', async () => {
  const sent: DetachedPacket[] = []
  const peer = new DetachedRequestPeer(connection, packet => sent.push(packet))
  let started = 0
  let complete!: () => void
  const active = new Promise<void>(resolve => { complete = resolve })
  peer.accept({ connection, kind: 'request', id: 'started', operation: 'command' }, async () => { started++; await active })
  await Promise.resolve()
  peer.accept({ connection, kind: 'request', id: 'queued', operation: 'command' }, async () => { started++ })
  peer.dispose()
  complete()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(started, 1)
  assert.deepEqual(sent, [])
})
test('发送同步失败立即释放请求，同一 ID 可显式重试', async () => {
  let fail = true
  const peer = new DetachedRequestPeer(connection, packet => {
    if (fail) throw new Error('transport_closed')
    peer.accept({ connection, kind: 'response', id: packet.id, payload: 'received' }, async () => undefined)
  })
  await assert.rejects(peer.request('command', undefined, 1000, 'stable-id'), /transport_closed/)
  fail = false
  assert.equal(await peer.request('command', undefined, 1000, 'stable-id'), 'received')
  peer.dispose()
})

test('重复请求共享一次业务执行，旧代请求不执行', async () => {
  const sent: DetachedPacket[] = []
  const peer = new DetachedRequestPeer(connection, packet => sent.push(packet))
  const request: DetachedPacket = { connection, kind: 'request', id: 'stable-id', operation: 'command' }
  let calls = 0
  const handle = async () => { calls++; return 'accepted' }
  peer.accept(request, handle)
  peer.accept(request, handle)
  assert.equal(peer.accept({ ...request, connection: { ...connection, generation: 'old' } }, handle), false)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls, 1)
  assert.equal(sent.length, 2)
  peer.dispose()
})

test('超时不重新提交业务请求，迟到响应被忽略', async () => {
  const sent: DetachedPacket[] = []
  const peer = new DetachedRequestPeer(connection, packet => sent.push(packet))
  await assert.rejects(peer.request('command', { action: 'submit' }, 5), /timeout/)
  assert.equal(sent.length, 1)
  peer.accept({ connection, kind: 'response', id: sent[0].id, payload: true }, async () => undefined)
  peer.dispose()
})

test('超时后的同 ID 查询复用已执行结果，不重复业务操作', async () => {
  let calls = 0
  let dropResponse = true
  const owner = new DetachedRequestPeer(connection, packet => { if (!dropResponse) client.accept(packet, async () => undefined) })
  const client = new DetachedRequestPeer(connection, packet => owner.accept(packet, async () => { calls++; return 'accepted' }))
  await assert.rejects(client.request('binary', { file: 'one' }, 5, 'stable-file-id'), /timeout/)
  dropResponse = false
  assert.equal(await client.request('binary', { file: 'one' }, 100, 'stable-file-id'), 'accepted')
  assert.equal(calls, 1)
  client.dispose()
  owner.dispose()
})

test('适配器声明的幂等读取释放响应，不把二进制内容留在去重表', async () => {
  const peer = new DetachedRequestPeer(connection, () => undefined)
  let calls = 0
  const read = async () => { calls++; return new ArrayBuffer(1024) }
  const packet: DetachedPacket = { connection, kind: 'request', id: 'preview', operation: 'binary' }
  peer.accept(packet, read, false)
  await new Promise(resolve => setTimeout(resolve, 0))
  peer.accept(packet, read, false)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls, 2)
  peer.dispose()
})
