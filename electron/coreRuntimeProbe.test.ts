import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchCoreRuntimeProbe } from './coreRuntimeProbe.ts'

test('Core 已返回响应头但响应体停滞时仍按请求期限中止', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"pid":'))
      init.signal?.addEventListener('abort', () => controller.error(new DOMException('请求已中止', 'AbortError')), { once: true })
    },
  })))
  await assert.rejects(fetchCoreRuntimeProbe('http://127.0.0.1:8122', 'fixture', 5), { name: 'AbortError' })
})

test('就绪探针只接受合法 PID 和版本文本，不强制转换错误类型', async (t) => {
  const payloads = [
    { pid: 42, version: ' 0.6.0 ' },
    { pid: '42', version: ['0.6.0'] },
    { pid: -1, version: 'v'.repeat(65) },
    null,
  ]
  t.mock.method(globalThis, 'fetch', async () => Response.json(payloads.shift()))
  assert.deepEqual(await fetchCoreRuntimeProbe('http://127.0.0.1:8122', '', 1000), { pid: 42, version: '0.6.0' })
  assert.deepEqual(await fetchCoreRuntimeProbe('http://127.0.0.1:8122', '', 1000), { pid: undefined, version: undefined })
  assert.deepEqual(await fetchCoreRuntimeProbe('http://127.0.0.1:8122', '', 1000), { pid: undefined, version: undefined })
  assert.equal(await fetchCoreRuntimeProbe('http://127.0.0.1:8122', '', 1000), null)
})

test('非成功的就绪响应主动释放未读取的响应体', async (t) => {
  let signal: AbortSignal | null | undefined
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    signal = init.signal
    return new Response(null, { status: 503 })
  })
  assert.equal(await fetchCoreRuntimeProbe('http://127.0.0.1:8122', '', 1000), null)
  assert.equal(signal?.aborted, true)
})
