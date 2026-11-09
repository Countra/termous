import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentImageRequests } from './agentImageRequests.ts'

test('共享图片请求直到最后一个使用者离开，之后按需重读', async () => {
  const requests = new AgentImageRequests()
  const a = new AbortController(), b = new AbortController()
  let calls = 0
  let source: AbortSignal | undefined
  const load = async (signal: AbortSignal) => { calls++; source = signal; return new Blob(['image']) }
  const [first, second] = await Promise.all([requests.read('one', load, a.signal), requests.read('one', load, b.signal)])
  assert.equal(first, second)
  assert.equal(calls, 1)
  a.abort(); assert.equal(source?.aborted, false)
  b.abort(); assert.equal(source?.aborted, true)
  await requests.read('one', load)
  assert.equal(calls, 2)
})

test('图片读取最多两项，取消等待不会启动第三项', async () => {
  const requests = new AgentImageRequests()
  let active = 0, peak = 0
  const finish: Array<() => void> = []
  const load = async () => {
    active++; peak = Math.max(active, peak)
    await new Promise<void>(resolve => finish.push(resolve))
    active--
    return new Blob(['image'])
  }
  const a = requests.read('a', load), b = requests.read('b', load)
  const controller = new AbortController()
  const c = requests.read('c', load, controller.signal)
  controller.abort()
  await assert.rejects(c, { name: 'AbortError' })
  finish.forEach(resolve => resolve())
  await Promise.all([a, b])
  assert.equal(peak, 2)
  assert.equal(finish.length, 2)
})
