import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import test from 'node:test'
import { WebSocketServer } from 'ws'
import { DesktopIndicatorConnection } from './connection.ts'

test('浮层收到无效快照时立即隐藏，即使服务端不响应关闭握手', { timeout: 5000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const events = new EventEmitter()
  const warnings: string[] = []
  const connection = new DesktopIndicatorConnection({
    config: async () => ({ apiBaseUrl: `http://127.0.0.1:${address.port}`, apiToken: 'test-token', version: 'test' }),
    snapshot: value => events.emit('snapshot', value), warn: code => warnings.push(code),
  })
  t.after(async () => {
    connection.close()
    for (const peer of server.clients) peer.terminate()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  const connected = once(server, 'connection')
  await connection.start()
  const [peer] = await connected
  const first = once(events, 'snapshot')
  peer.send(JSON.stringify({ instance_id: 'core', controls: [] }))
  assert.deepEqual(await first, [{ instance_id: 'core', controls: [] }])
  // 暂停服务端读取，确保验证不依赖对端的关闭握手。
  peer.pause()
  const hidden = once(events, 'snapshot', { signal: AbortSignal.timeout(1000) })
  peer.send('{"invalid":true}')
  assert.deepEqual(await hidden, [null])
  assert.deepEqual(warnings, ['desktop_indicator_snapshot_failed'])
  await assert.rejects(connection.reclaim({ instance_id: 'core', reference: 'a'.repeat(64),
    target: { kind: 'protocol_session', protocol: { session_id: 'session', connection_generation: 1 } },
  }), /desktop_indicator_disconnected/)
})

test('关闭后迟到的配置结果不再发布状态或发起重连，重复关闭无副作用', async () => {
  for (const rejected of [false, true]) {
    let finish!: () => void
    const warnings: string[] = []
    const snapshots: unknown[] = []
    const connection = new DesktopIndicatorConnection({
      config: () => new Promise((resolve, reject) => {
        finish = () => rejected ? reject(new Error('配置加载已终止'))
          : resolve({ apiBaseUrl: 'http://127.0.0.1:1', apiToken: 'test-token', version: 'test' })
      }),
      snapshot: value => snapshots.push(value), warn: code => warnings.push(code),
    })
    const starting = connection.start()
    connection.close()
    connection.close()
    finish()
    await starting
    await connection.start()
    assert.deepEqual(snapshots, [null])
    assert.deepEqual(warnings, [])
  }
})
