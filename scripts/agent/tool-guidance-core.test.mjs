import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { WebSocketServer } from 'ws'
import { assertGuidanceCoreIdle, guidanceHeartbeat } from './tool-guidance-core.mjs'

test('全局领取验收拒绝其他活动或排队任务，并要求完整权威快照', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  let snapshot
  server.on('connection', (socket) => socket.send(JSON.stringify(snapshot)))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    snapshot = { type: 'snapshot', active_runs: [], queued_turns: [] }
    await assertGuidanceCoreIdle(url)
    snapshot.active_runs.push({ id: 'mine' })
    await assert.rejects(assertGuidanceCoreIdle(url), /其他活动或排队任务/)
    await assertGuidanceCoreIdle(url, 'mine')
    snapshot.active_runs.push({ id: 'other' })
    await assert.rejects(assertGuidanceCoreIdle(url, 'mine'), /其他活动或排队任务/)
    snapshot.active_runs = []
    snapshot.queued_turns.push({ id: 'queued' })
    await assert.rejects(assertGuidanceCoreIdle(url), /其他活动或排队任务/)
    snapshot = { type: 'snapshot' }
    await assert.rejects(assertGuidanceCoreIdle(url), /缺少调度状态/)
  } finally {
    for (const socket of server.clients) socket.terminate()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('心跳不重叠，停止时等待在途注册完成且不再启动后续请求', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let finish, count = 0, stopped = false
  const heartbeat = guidanceHeartbeat(() => { count++; return new Promise((resolve) => { finish = resolve }) })
  t.mock.timers.tick(10000)
  t.mock.timers.tick(20000)
  assert.equal(count, 1)
  const stop = heartbeat.stop().then(() => { stopped = true })
  await Promise.resolve()
  assert.equal(stopped, false)
  finish()
  await stop
  t.mock.timers.tick(20000)
  assert.equal(count, 1)
})

test('心跳失败保留异常供主循环中止，停止仍可释放宿主', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const heartbeat = guidanceHeartbeat(async () => { throw new Error('fixture') })
  t.mock.timers.tick(10000)
  await heartbeat.stop()
  assert.throws(() => heartbeat.check(), /心跳失效/)
})
