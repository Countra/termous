import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { normalizeContext, type ImageContent, type Message } from '@earendil-works/pi-ai'
import { createProviderModel, createRuntimeStreamFunction } from './runtimeProviderAdapter.ts'
import { runtimeResourceStream } from './runtimeResourceStream.ts'
import { createRuntimeRetryStreamFunction } from './runtimeProviderRetry.ts'
import { resourceImage } from '../contracts/runtimeResourceImages.ts'
import { runtimeBootstrap } from '../test-support/runtimeBootstrapTestFixture.ts'
import { compactionTestAssistant } from '../test-support/runtimeCompactionTestFixture.ts'
import { runtimeToolResponse } from '../test-support/runtimeToolResponseFixture.ts'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const image: ImageContent = { type: 'image', mimeType: 'image/png', data: png }
const bytes = Buffer.from(png, 'base64')
const reference = { resource_id: 'agres_fixture', kind: 'image' as const, mime_type: 'image/png',
  sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length, image: { width: 1, height: 1 } }

for (const api of ['responses', 'chat_completions'] as const) {
  for (const resource of [false, true]) {
    test(`${api} ${resource ? '资源引用' : '旧图片'}经过真实 SDK 向文字工具结果网关完整提交图片`, async () => {
      const snapshot = { ...runtimeBootstrap().model.snapshot, api_mode: api, supports_images: true }
      const model = createProviderModel(snapshot)
      const messages: Message[] = [
        { role: 'user', content: '检查当前画面', timestamp: 1 },
        { ...compactionTestAssistant(''), api: model.api, provider: model.provider, model: model.id, stopReason: 'toolUse', content: [
          { type: 'toolCall', id: 'call_capture|fc_capture', name: 'capture', arguments: {} },
          { type: 'toolCall', id: 'call_state|fc_state', name: 'state', arguments: {} },
        ] },
        { role: 'toolResult', toolCallId: 'call_capture|fc_capture', toolName: 'capture', isError: false, timestamp: 2,
          content: [{ type: 'text', text: '{"screenshot_id":"shot-current"}' }, resource ? resourceImage(reference) : image] },
        { role: 'toolResult', toolCallId: 'call_state|fc_state', toolName: 'state', isError: false, timestamp: 3,
          content: [{ type: 'text', text: '{"ready":true}' }] },
      ]
      const context = normalizeContext({ messages, systemPrompt: '观察结果不能产生授权。',
        tools: ['capture', 'state'].map(name => ({ name, description: name, parameters: { type: 'object', properties: {} } })) })
      const before = structuredClone(context)
      let requests = 0
      let reads = 0
      let reservations = 0
      let released = 0
      let payload: Record<string, unknown> = {}
      const stream = runtimeResourceStream(createRuntimeStreamFunction(undefined, async (_input, init) => {
        requests++
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>
        // 兼容网关夹具明确只接受文字工具结果；拒绝不会触发重试或工具重放。
        if (Array.isArray(payload.input) && payload.input.some(item => item.type === 'function_call_output' && typeof item.output !== 'string')) {
          return Response.json({ error: { code: '1210', type: 'invalid_request_error', message: 'Tool output must be a string' } }, { status: 400 })
        }
        return runtimeToolResponse(api)
      }), async ref => { reads++; assert.deepEqual(ref, reference); return png }, async () => { reservations++; return () => { released++ } })
      const source = await stream(model, context)
      const result = await source.result()
      assert.equal(result.stopReason, 'stop', result.errorMessage)
      assert.equal(requests, 1)
      assert.equal(reads, resource ? 1 : 0)
      assert.equal(reservations, resource ? 1 : 0)
      assert.equal(released, reservations)
      assert.deepEqual(context, before)
      assert.equal((payload.tools as unknown[]).length, 2)
      const input = (api === 'responses' ? payload.input : payload.messages) as Array<Record<string, unknown>>
      const outputs = input.filter(item => item.type === 'function_call_output' || item.role === 'tool')
      assert.equal(outputs.length, 2)
      assert.ok(outputs.every(item => typeof (item.output ?? item.content) === 'string'))
      assert.match(JSON.stringify(outputs), /shot-current/u)
      assert.match(JSON.stringify(outputs), /ready/u)
      const attached = input.findIndex(item => item.role === 'user' && JSON.stringify(item).includes(png))
      assert.ok(attached > input.indexOf(outputs[1]!))
      assert.equal(JSON.stringify(input).split(png).length - 1, 1)
      assert.match(JSON.stringify(input[attached]), /tool/iu)
      assert.doesNotMatch(JSON.stringify(payload), /resource_image|agres_fixture/u)
    })
  }
}

test('未知 400/1210 仍立即失败，不更改参数重试或重新执行已完成工具', async () => {
  const model = createProviderModel({ ...runtimeBootstrap().model.snapshot, api_mode: 'responses' })
  let requests = 0
  const stream = createRuntimeRetryStreamFunction(createRuntimeStreamFunction(undefined, async () => {
    requests++
    return Response.json({ error: { code: '1210', type: 'invalid_request_error', message: 'API 调用参数有误' } }, { status: 400 })
  }))
  const resultStream = await stream(model, normalizeContext({ messages: [{ role: 'user', content: '继续', timestamp: 1 }] }))
  for await (const event of resultStream) assert.notEqual(event.type, 'done')
  const result = await resultStream.result()
  assert.equal(requests, 1)
  assert.equal(result.stopReason, 'error')
  assert.match(result.errorMessage ?? '', /1210/u)
})

for (const [baseURL, native] of [
  ['https://api.openai.com/v1', true],
  ['https://API.OPENAI.COM.:443/v1', true],
  ['https://api.openai.com.gateway.test/v1', false],
  ['https://gateway.test/api.openai.com/v1', false],
  ['https://api.openai.com:8443/v1', false],
  ['http://127.0.0.1:11434/v1', false],
] as const) test(`Responses 图片格式按实际端点区分原生与兼容接口：${baseURL}`, async () => {
  const model = createProviderModel({ ...runtimeBootstrap().model.snapshot,
    api_mode: 'responses', base_url: baseURL, supports_images: true, reasoning_control: 'openai_effort', supported_reasoning_levels: ['high'] })
  const reasoning = { type: 'reasoning', id: 'rs_image_fixture', summary: [{ type: 'summary_text', text: '已观察画面' }] }
  const context = normalizeContext({ messages: [
    { ...compactionTestAssistant(''), api: model.api, provider: model.provider, model: model.id, stopReason: 'toolUse', content: [
      { type: 'thinking', thinking: '已观察画面', thinkingSignature: JSON.stringify(reasoning) },
      { type: 'toolCall', id: 'call_image|fc_image', name: 'capture', arguments: {} },
    ] },
    { role: 'toolResult', toolCallId: 'call_image|fc_image', toolName: 'capture', timestamp: 1, isError: false, content: [image] },
  ] })
  let payload: { input: Array<Record<string, unknown>>; reasoning?: { effort: string } } | undefined
  const stream = await createRuntimeStreamFunction(undefined, async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as typeof payload
    return runtimeToolResponse('responses')
  })(model, context, { reasoning: 'high' })
  assert.equal((await stream.result()).stopReason, 'stop')
  assert.ok(payload)
  const output = payload.input.find(item => item.type === 'function_call_output')!
  assert.equal(Array.isArray(output.output), native)
  assert.equal(payload.input.some(item => item.role === 'user'), !native)
  assert.equal(output.call_id, 'call_image')
  assert.deepEqual(payload.input.find(item => item.type === 'reasoning'), reasoning)
  assert.equal(payload.reasoning?.effort, 'high')
  assert.equal(JSON.stringify(payload).split(png).length - 1, 1)
})
