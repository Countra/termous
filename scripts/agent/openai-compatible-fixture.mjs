import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const agentModelFixtureID = 'termous-agent-fixture'
export const agentModelFixtureDefaultPort = 18188
export const agentModelFixtureToolName = 'm_termous_dhosts_dlist'
export const agentModelFixtureApprovalToolName = 'm_termous_dsnippets_dcreate'
export const agentModelFixturePrompts = Object.freeze({
  basic: 'fixture:basic',
  reasoning: 'fixture:reasoning',
  tool: 'fixture:tool-hosts',
  approval: 'fixture:approval-reject',
  slow: 'fixture:slow',
})

const maximumRequestBodyBytes = 2 * 1024 * 1024
const defaultChunkDelayMs = 18
const defaultSlowDelayMs = 30_000
const maximumSlowDelayMs = 5 * 60_000
const completionPath = '/v1/chat/completions'
const modelsPath = '/v1/models'

export function createAgentModelFixture(options = {}) {
  const chunkDelayMs = normalizedDelay(options.chunkDelayMs, defaultChunkDelayMs, 1_000)
  const slowDelayMs = normalizedDelay(options.slowDelayMs, defaultSlowDelayMs, maximumSlowDelayMs)
  const state = { approvalRequestSequence: 0 }
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, { chunkDelayMs, slowDelayMs, state }).catch(() => {
      if (!response.headersSent) {
        writeJSON(response, 500, providerError('fixture_internal_error', 'Fixture 处理请求失败'))
      } else if (!response.destroyed) {
        response.destroy()
      }
    })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = maximumSlowDelayMs + 30_000
  server.keepAliveTimeout = 2_000

  return {
    address: () => server.address(),
    listen: (port = agentModelFixtureDefaultPort) => listenLoopback(server, port),
    close: () => closeServer(server),
  }
}

async function handleRequest(request, response, options) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/healthz' && url.search === '') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET'])
    }
    return writeJSON(response, 200, {
      status: 'ok',
      model: agentModelFixtureID,
    })
  }
  if (url.pathname === modelsPath && url.search === '') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET'])
    }
    return writeJSON(response, 200, {
      object: 'list',
      data: [{
        id: agentModelFixtureID,
        object: 'model',
        created: 1,
        owned_by: 'termous',
      }],
    })
  }
  if (url.pathname !== completionPath || url.search !== '') {
    return writeJSON(response, 404, providerError('not_found', '接口不存在'))
  }
  if (request.method !== 'POST') {
    return methodNotAllowed(response, ['POST'])
  }
  if (!isJSONContentType(request.headers['content-type'])) {
    return writeJSON(response, 415, providerError('unsupported_media_type', '请求必须使用 JSON'))
  }

  const parsed = await readJSONBody(request)
  if (parsed.status !== 'ok') {
    return writeJSON(response, parsed.status, providerError(parsed.code, parsed.message))
  }
  const input = normalizeCompletionInput(parsed.value)
  if (!input) {
    return writeJSON(response, 400, providerError('invalid_request', '请求合同不兼容'))
  }
  if (!input.stream) {
    return writeProbeResponse(response, input.model)
  }

  const scenario = resolveScenario(input.messages)
  const requiredTool = scenario === 'tool'
    ? agentModelFixtureToolName
    : scenario === 'approval'
      ? agentModelFixtureApprovalToolName
      : ''
  if (requiredTool && !hasTool(input.tools, requiredTool)) {
    return writeJSON(response, 400, providerError('fixture_tool_missing', '缺少联调场景所需的 Tool'))
  }
  return writeStreamResponse(request, response, input, scenario, options)
}

function writeProbeResponse(response, model) {
  return writeJSON(response, 200, {
    id: 'chatcmpl-termous-fixture-probe',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'OK' },
      finish_reason: 'stop',
    }],
    usage: usage(4, 1, 0),
  })
}

async function writeStreamResponse(request, response, input, scenario, options) {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  const stream = createFixtureStream(request, response, input.model, options.chunkDelayMs)
  if (!stream.chunk({ role: 'assistant' })) {
    return
  }

  if (scenario === 'slow') {
    if (!await delayWhileConnected(request, response, options.slowDelayMs)) {
      return
    }
    await stream.text(['慢响应已完成。'])
    return stream.finish('stop', usage(12, 5, 0))
  }
  if (scenario === 'reasoning') {
    await stream.reasoning(['正在验证 reasoning ', '流式投影。'])
    await stream.text(['reasoning 已完成，', '正文继续正常输出。'])
    return stream.finish('stop', usage(18, 12, 5))
  }
  if (scenario === 'tool') {
    if (hasToolResult(input.messages, 'call_termous_fixture_hosts_list')) {
      await stream.text(['已完成一次只读主机列表调用，', '并根据 Tool 结果继续回答。'])
      return stream.finish('stop', usage(24, 12, 0))
    }
    stream.chunk({
      tool_calls: [{
        index: 0,
        id: 'call_termous_fixture_hosts_list',
        type: 'function',
        function: {
          name: agentModelFixtureToolName,
          arguments: '{}',
        },
      }],
    })
    return stream.finish('tool_calls', usage(20, 4, 0))
  }
  if (scenario === 'approval') {
    if (hasToolResult(input.messages, 'call_termous_fixture_snippet_create')) {
      await stream.text(['审批拒绝已返回 Agent，', '测试数据未写入。'])
      return stream.finish('stop', usage(28, 12, 0))
    }
    stream.chunk({
      tool_calls: [{
        index: 0,
        id: 'call_termous_fixture_snippet_create',
        type: 'function',
        function: {
          name: agentModelFixtureApprovalToolName,
          arguments: JSON.stringify({
            client_request_id: `agent-stage4-fixture-reject-${++options.state.approvalRequestSequence}`,
            name: 'Agent Stage 4 Approval Fixture',
            command: 'echo fixture',
            shell: 'sh',
          }),
        },
      }],
    })
    return stream.finish('tool_calls', usage(24, 4, 0))
  }

  await stream.text(['这是本地 Fixture 的', '确定性流式回复。'])
  return stream.finish('stop', usage(14, 8, 0))
}

function createFixtureStream(request, response, model, chunkDelayMs) {
  const id = 'chatcmpl-termous-agent-fixture'
  const chunk = (delta, finishReason = null, streamUsage) => writeSSE(response, {
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(streamUsage ? { usage: streamUsage } : {}),
  })
  const writeParts = async (field, parts) => {
    for (const part of parts) {
      if (!chunk({ [field]: part })) {
        return false
      }
      if (!await delayWhileConnected(request, response, chunkDelayMs)) {
        return false
      }
    }
    return true
  }
  return {
    chunk,
    text: (parts) => writeParts('content', parts),
    reasoning: (parts) => writeParts('reasoning_content', parts),
    finish: (reason, streamUsage) => {
      if (!chunk({}, reason, streamUsage)) {
        return false
      }
      if (!response.writableEnded && !response.destroyed) {
        response.end('data: [DONE]\n\n')
      }
      return true
    },
  }
}

function normalizeCompletionInput(value) {
  if (!isRecord(value)
    || typeof value.model !== 'string'
    || value.model.trim() === ''
    || value.model.length > 200
    || !Array.isArray(value.messages)
    || value.messages.length === 0
    || typeof value.stream !== 'boolean') {
    return null
  }
  return {
    model: value.model.trim(),
    messages: value.messages,
    tools: Array.isArray(value.tools) ? value.tools : [],
    stream: value.stream,
  }
}

function resolveScenario(messages) {
  const prompt = latestUserText(messages)
  if (prompt.includes(agentModelFixturePrompts.reasoning)) return 'reasoning'
  if (prompt.includes(agentModelFixturePrompts.tool)) return 'tool'
  if (prompt.includes(agentModelFixturePrompts.approval)) return 'approval'
  if (prompt.includes(agentModelFixturePrompts.slow)) return 'slow'
  return 'basic'
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== 'user') {
      continue
    }
    if (typeof message.content === 'string') {
      return message.content
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
    }
  }
  return ''
}

function hasToolResult(messages, toolCallID) {
  return messages.some((message) => isRecord(message)
    && message.role === 'tool'
    && message.tool_call_id === toolCallID)
}

function hasTool(tools, expectedName) {
  return tools.some((tool) => isRecord(tool)
    && tool.type === 'function'
    && isRecord(tool.function)
    && tool.function.name === expectedName)
}

async function readJSONBody(request) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += chunk.byteLength
      if (size > maximumRequestBodyBytes) {
        return {
          status: 413,
          code: 'request_too_large',
          message: '请求超过 Fixture 大小上限',
        }
      }
      chunks.push(chunk)
    }
    return {
      status: 'ok',
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }
  } catch {
    return {
      status: 400,
      code: 'invalid_json',
      message: '请求不是有效 JSON',
    }
  }
}

function writeSSE(response, value) {
  if (response.destroyed || response.writableEnded) {
    return false
  }
  response.write(`data: ${JSON.stringify(value)}\n\n`)
  // 单帧均为有界小消息；write() 的 false 只表示背压，不代表连接已经失败。
  return !response.destroyed && !response.writableEnded
}

function delayWhileConnected(request, response, delayMs) {
  if (delayMs === 0) {
    return Promise.resolve(!request.aborted && !response.destroyed && !response.writableEnded)
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (connected) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.removeListener('aborted', onClosed)
      response.removeListener('close', onClosed)
      resolve(connected)
    }
    const onClosed = () => finish(false)
    const timer = setTimeout(() => finish(
      !request.aborted && !response.destroyed && !response.writableEnded,
    ), delayMs)
    request.once('aborted', onClosed)
    response.once('close', onClosed)
  })
}

function writeJSON(response, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': String(body.byteLength),
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

function providerError(code, message) {
  return { error: { code, message, type: 'invalid_request_error' } }
}

function methodNotAllowed(response, allowed) {
  response.setHeader('Allow', allowed.join(', '))
  return writeJSON(response, 405, providerError('method_not_allowed', '请求方法不受支持'))
}

function usage(promptTokens, completionTokens, reasoningTokens) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    completion_tokens_details: { reasoning_tokens: reasoningTokens },
  }
}

function isJSONContentType(value) {
  return typeof value === 'string'
    && value.toLowerCase().split(';', 1)[0].trim() === 'application/json'
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedDelay(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fallback
}

function listenLoopback(server, port) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(new Error('Agent Fixture 端口无效'))
  }
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve(server.address())
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

function environmentInteger(name, fallback, maximum) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} 必须是 0 到 ${maximum} 之间的整数`)
  }
  return value
}

async function main() {
  const port = environmentInteger(
    'TERMOUS_AGENT_FIXTURE_PORT',
    agentModelFixtureDefaultPort,
    65535,
  )
  const slowDelayMs = environmentInteger(
    'TERMOUS_AGENT_FIXTURE_SLOW_DELAY_MS',
    defaultSlowDelayMs,
    maximumSlowDelayMs,
  )
  const fixture = createAgentModelFixture({ slowDelayMs })
  const address = await fixture.listen(port)
  if (!address || typeof address === 'string') {
    throw new Error('Agent Fixture 未返回 TCP 地址')
  }
  console.log(JSON.stringify({
    event: 'agent_model_fixture_ready',
    base_url: `http://127.0.0.1:${address.port}/v1`,
    model_id: agentModelFixtureID,
    prompts: agentModelFixturePrompts,
  }))

  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    void fixture.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
