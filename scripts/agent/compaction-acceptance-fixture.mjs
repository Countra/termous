import assert from 'node:assert/strict'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

export const compactionFixturePort = 18189
export const compactionFixtureModel = 'termous-compaction-acceptance'
export const compactionFixtureSkillURI = 'skill://termous-compaction-acceptance/SKILL.md'
export const compactionFixtureSteer = 'COMPACTION_STEER_ONCE：保留最新追加约束。'

export function createCompactionAcceptanceFixture() {
  let scenario
  const requests = []
  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      if (!response.destroyed) response.end(JSON.stringify({ error: { message: error.message } }))
    })
  })
  async function handle(request, response) {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: compactionFixtureModel, object: 'model' }] }))
      return
    }
    assert.equal(request.method, 'POST')
    assert.ok(request.url === '/v1/chat/completions' || request.url === '/v1/responses')
    let body = ''
    for await (const chunk of request) {
      body += chunk.toString('utf8')
      assert.ok(Buffer.byteLength(body) <= 4 * 1024 * 1024, '验收请求超出限制')
    }
    const input = JSON.parse(body)
    assert.equal(input.model, compactionFixtureModel)
    assert.ok(scenario, '验收场景尚未启动')
    const responses = request.url.endsWith('/responses')
    const messages = responses ? input.input : input.messages
    const serialized = JSON.stringify(messages)
    const tools = input.tools ?? []
    const summary = tools.length === 0
    if (summary) assert.match(serialized + (input.instructions ?? ''), /summari[sz]|摘要|context checkpoint/iu)
    const entry = {
      scenario: scenario.name, mode: responses ? 'responses' : 'chat_completions',
      kind: summary ? 'summary' : 'main', ordinal: requests.length + 1,
      input_chars: body.length, tool_count: tools.length,
      reasoning: input.reasoning?.effort ?? input.reasoning_effort ?? 'off',
      steer_count: serialized.split('COMPACTION_STEER_ONCE').length - 1,
      summary_count: serialized.split('conversation history before this point was compacted').length - 1,
      markers: [...serialized.matchAll(/COMPACTION_BLOCK_\d+/gu)].map((match) => match[0]),
    }
    requests.push(entry)
    let text
    let call
    let finish = 'stop'
    if (summary) {
      scenario.summaries += 1
      await scenario.onSummary?.(scenario.summaries)
      await delay(250)
      if (scenario.name.endsWith('-cancel')) await delay(5000)
      text = ' \n## Goal\nCOMPACTION_SUMMARY_MARKER：继续安全读取本地 Skill 的验收。\n## Progress\n已完成先前工具读取。\n## Next Steps\n继续尚未完成的读取，保留用户新增约束。\n '
      if (scenario.name.endsWith('-length')) finish = 'length'
    } else {
      scenario.steps += 1
      assert.ok(tools.some((tool) => (tool.function?.name ?? tool.name) === 'read_skill_resource'))
      if (scenario.steps <= scenario.rounds) {
        text = `COMPACTION_BLOCK_${scenario.steps} ` + 'local-fixture-data '.repeat(2800)
        call = { id: `call_compaction_${scenario.steps}`, name: 'read_skill_resource', arguments: JSON.stringify({ uri: compactionFixtureSkillURI }) }
      } else {
        text = 'COMPACTION_ACCEPTANCE_DONE：安全验收完成。'
      }
    }
    if (response.destroyed) return
    const tokens = { input: Math.ceil(body.length / 4), output: Math.ceil(text.length / 4) + (call ? 30 : 0) }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`)
    if (responses) writeResponses(send, input.model, text, call, finish, tokens)
    else writeChat(send, input.model, text, call, finish, tokens)
    response.end()
  }
  return {
    requests,
    arm(name, rounds, onSummary) { scenario = { name, rounds, steps: 0, summaries: 0, onSummary } },
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(compactionFixturePort, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    }),
    close: () => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(resolve)
    }),
  }
}

function writeChat(send, model, text, call, finish, tokens) {
  const chunk = (delta, reason = null, usage) => send({
    id: 'chatcmpl_compaction_fixture', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta, finish_reason: reason }], ...(usage ? { usage } : {}),
  })
  chunk({ role: 'assistant' })
  for (let offset = 0; offset < text.length; offset += 4096) chunk({ content: text.slice(offset, offset + 4096) })
  if (call) chunk({ tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] })
  chunk({}, call ? 'tool_calls' : finish, {
    prompt_tokens: tokens.input, completion_tokens: tokens.output, total_tokens: tokens.input + tokens.output,
  })
}

function writeResponses(send, model, text, call, finish, tokens) {
  const response = {
    id: 'resp_compaction_fixture', object: 'response', model, created_at: 1,
    status: finish === 'length' ? 'incomplete' : 'completed', output: [],
    ...(finish === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    usage: { input_tokens: tokens.input, output_tokens: tokens.output, total_tokens: tokens.input + tokens.output },
  }
  send({ type: 'response.created', response: { ...response, status: 'in_progress' } })
  const message = { type: 'message', id: 'msg_compaction_fixture', role: 'assistant', status: 'in_progress', content: [] }
  send({ type: 'response.output_item.added', output_index: 0, item: message })
  for (let offset = 0; offset < text.length; offset += 4096) {
    send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text.slice(offset, offset + 4096) })
  }
  const completed = { ...message, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
  send({ type: 'response.output_item.done', output_index: 0, item: completed })
  response.output.push(completed)
  if (call) {
    const item = { type: 'function_call', id: `fc_${call.id}`, call_id: call.id, name: call.name, arguments: call.arguments, status: 'completed' }
    send({ type: 'response.output_item.added', output_index: 1, item: { ...item, arguments: '', status: 'in_progress' } })
    send({ type: 'response.function_call_arguments.delta', output_index: 1, delta: call.arguments })
    send({ type: 'response.output_item.done', output_index: 1, item })
    response.output.push(item)
  }
  send({ type: finish === 'length' ? 'response.incomplete' : 'response.completed', response })
}
