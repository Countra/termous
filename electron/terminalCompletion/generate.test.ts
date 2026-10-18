import assert from 'node:assert/strict'
import test from 'node:test'
import { generateTerminalCommand, parseTerminalCommand } from './generate.ts'
import { completionTestBootstrap, completionTestRequest } from './testFixture.ts'

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 单次命令生成复用 pi 解析，预算和推理档位有界且不携带工具`, async () => {
    const bootstrap = completionTestBootstrap()
    bootstrap.model.snapshot.api_mode = api
    let calls = 0
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      calls += 1
      assert.equal(new URL(String(input)).pathname, api === 'responses' ? '/v1/responses' : '/v1/chat/completions')
      assert.equal(init?.redirect, 'manual')
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-secret')
      const body = JSON.parse(String(init?.body))
      const system = (body.messages ?? body.input).filter((message: { role: string }) => message.role === 'system')
      assert.equal(system.length, 1)
      assert.match(JSON.stringify(system), /绝不能执行命令、调用工具/u)
      assert.ok(body.tools === undefined || body.tools.length === 0)
      assert.equal(api === 'responses' ? body.max_output_tokens : body.max_completion_tokens, 2048)
      assert.equal(api === 'responses' ? body.reasoning.effort : body.reasoning_effort, 'low')
      return successResponse(api, '{"command":"df -h","description":"查看磁盘空间"}')
    }
    const result = await generateTerminalCommand(completionTestRequest(), bootstrap, new AbortController().signal, fetcher)
    assert.equal(result.status, 'completed')
    if (result.status === 'completed') {
      assert.equal(result.command, 'df -h')
      assert.equal(result.model.providerName, '测试 Provider')
    }
    assert.equal(calls, 1)
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret|\/home\/test/u)
  })

  test(`${api} 达到输出上限时即使命令JSON完整也不能作为成功建议`, async () => {
    const bootstrap = completionTestBootstrap()
    bootstrap.model.snapshot.api_mode = api
    let requests = 0
    let usageCallbacks = 0
    const result = await generateTerminalCommand(completionTestRequest(), bootstrap, new AbortController().signal,
      async () => { requests++; return successResponse(api, '{"command":"df -h","description":"查看空间"}', true) },
      () => { usageCallbacks++ })
    assert.equal(result.status, 'failed')
    if (result.status === 'failed') assert.equal(result.code, 'TERMINAL_AI_OUTPUT_TRUNCATED')
    assert.equal(requests, 1)
    assert.equal(usageCallbacks, 1)
  })
}

test('临时模型错误也只请求一次，错误脱敏且不泄漏认证信息', async () => {
  let calls = 0
  const result = await generateTerminalCommand(completionTestRequest(), completionTestBootstrap(), new AbortController().signal, async () => {
    calls += 1
    return new Response(JSON.stringify({ error: { message: '503 overloaded api_key=fixture-secret' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'failed')
  assert.match(JSON.stringify(result), /overloaded/u)
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/u)
})

test('模型支持关闭推理时发送none，较小输出预算不扩大到2048', async () => {
  const bootstrap = completionTestBootstrap()
  bootstrap.model.snapshot.supported_reasoning_levels = ['off', 'low']
  bootstrap.model.snapshot.max_output_tokens = 1024
  const result = await generateTerminalCommand(completionTestRequest(), bootstrap, new AbortController().signal, async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.reasoning.effort, 'none')
    assert.equal(body.max_output_tokens, 1024)
    return successResponse('responses', '{"command":"df -h","description":"磁盘空间"}')
  })
  assert.equal(result.status, 'completed')
})

test('取消不触网，模型无命令返回明确结果', async () => {
  const abort = new AbortController()
  abort.abort()
  const cancelled = await generateTerminalCommand(completionTestRequest(), completionTestBootstrap(), abort.signal, async () => { throw new Error('不应触网') })
  assert.equal(cancelled.status, 'cancelled')
  const noCommand = await generateTerminalCommand(completionTestRequest(), completionTestBootstrap(), new AbortController().signal,
    async () => successResponse('responses', '{"command":"","description":"需要提供目标文件"}'))
  assert.equal(noCommand.status, 'failed')
  if (noCommand.status === 'failed') assert.equal(noCommand.code, 'TERMINAL_AI_NO_COMMAND')
})

test('仅接受严格 JSON 中的单行命令，拒绝围栏、控制符、工具结构及超限结果', () => {
  assert.deepEqual(parseTerminalCommand('{"command":" echo ok ","description":" 说明 "}'), { command: 'echo ok', description: '说明' })
  for (const text of ['```json\n{}\n```', '{"command":"a\\nb","description":""}', '{"command":"a\\u001bb","description":""}',
    '{"command":"a\\u2028b","description":""}', '{"command":"echo ok","description":"","tool":"x"}',
    '{"command":null,"description":""}', '{"command":"echo ok","description":"  "}',
    '{"command":"","description":""}', JSON.stringify({ command: 'x'.repeat(4097), description: '超限' })]) {
    assert.equal(parseTerminalCommand(text), undefined)
  }
})

function successResponse(api: 'responses' | 'chat_completions', text: string, truncated = false) {
  if (api === 'chat_completions') {
    return new Response(`data: ${JSON.stringify({ id: 'chat_test', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: truncated ? 'length' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const events = [
    { type: 'response.created', response: { id: 'resp_test', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_test', role: 'assistant', status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    truncated
      ? { type: 'response.incomplete', response: { id: 'resp_test', status: 'incomplete', output: [], incomplete_details: { reason: 'max_output_tokens' } } }
      : { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [] } },
  ]
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}
