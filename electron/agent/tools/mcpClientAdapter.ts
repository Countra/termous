import type { MCPToolDetails, AgentMCPConnection } from '../contracts/mcpTools.ts'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool as MCPTool,
} from '@modelcontextprotocol/client'
import type { TSchema } from 'typebox'
import { Compile } from 'typebox/compile'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { agentToolImageReference, isAgentDisplayImageMIMEType } from '#common/contracts'

export const agentMCPProtocolVersion = '2025-11-25'

const mcpConnectTimeoutMs = 15_000
const mcpToolTimeoutMs = 10 * 60_000
const maximumEncodedToolNameLength = 64

export interface ConnectAgentMCPOptions {
  coreBaseURL: string
  endpoint: string
  bearerToken: string
  protocolVersion: string
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
}

export async function connectAgentMCP(
  options: ConnectAgentMCPOptions,
): Promise<AgentMCPConnection> {
  if (options.protocolVersion !== agentMCPProtocolVersion) {
    throw new Error('AGENT_MCP_PROTOCOL_MISMATCH')
  }
  const endpoint = resolveMCPEndpoint(options.coreBaseURL, options.endpoint)
  const fetchImplementation = createExactEndpointFetch(endpoint, options.fetch)
  const client = new Client(
    { name: 'termous-builtin-agent', version: '1.0.0' },
    {
      supportedProtocolVersions: [agentMCPProtocolVersion],
      versionNegotiation: { mode: 'legacy' },
      enforceStrictCapabilities: true,
      inputRequired: { autoFulfill: false },
    },
  )
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: async () => options.bearerToken },
    requestInit: { cache: 'no-store' },
    fetch: fetchImplementation,
    reconnectionOptions: {
      initialReconnectionDelay: 1_000,
      maxReconnectionDelay: 1_000,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
    onInsufficientScope: 'throw',
    maxStepUpRetries: 0,
  })

  let closing: Promise<void> | undefined
  const close = () => closing ??= (async () => {
    // 正常退出与初始化失败共用回收路径；SDK close 本身只关闭传输。
    try { await transport.terminateSession() } finally { await client.close() }
  })()

  try {
    await client.connect(transport, {
      signal: options.signal,
      timeout: mcpConnectTimeoutMs,
    })
    if (client.getNegotiatedProtocolVersion() !== agentMCPProtocolVersion) {
      throw new Error('AGENT_MCP_PROTOCOL_MISMATCH')
    }
    const listed = await client.listTools(undefined, {
      signal: options.signal,
      timeout: mcpConnectTimeoutMs,
      cacheMode: 'bypass',
    })
    const invocation = createSerialToolInvoker(async (definition, args, signal, toolCallID) => {
      return await client.callTool(
        { name: definition.name, arguments: args, ...(toolCallID ? { _meta: { 'termous/tool-call-id': toolCallID } } : {}) },
        {
          signal,
          timeout: mcpToolTimeoutMs,
          maxTotalTimeout: mcpToolTimeoutMs,
          toolDefinition: definition,
        },
      )
    })
    const mapped = mapMCPTools(listed.tools, invocation)
    return {
      tools: mapped.tools,
      originalName: (encodedName) => mapped.originalNames.get(encodedName) ?? null,
      readOnly: (name) => listed.tools.some((tool) => tool.name === name && tool.annotations?.readOnlyHint === true),
      close,
    }
  } catch (error) {
    try {
      await close()
    } catch (cleanupError) {
      throw Object.assign(new Error('AGENT_MCP_INITIALIZATION_CLEANUP_FAILED'), { cause: error, cleanupError })
    }
    throw error
  }
}

export type MCPToolInvoker = (
  definition: MCPTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  toolCallID?: string,
) => Promise<CallToolResult>

export function mapMCPTools(
  definitions: MCPTool[],
  invoke: MCPToolInvoker,
) {
  // 工具目录由 Core 按当前能力与权限返回，不能把旧版本的工具数量作为启动条件。
  if (definitions.length === 0) {
    throw new Error('AGENT_MCP_TOOLS_EMPTY')
  }
  const originalNames = new Map<string, string>()
  const tools = definitions.map((definition): AgentTool => {
    const encodedName = encodeMCPToolName(definition.name)
    if (!validEncodedToolName(encodedName) || originalNames.has(encodedName)) {
      throw new Error('AGENT_MCP_TOOL_NAME_CONFLICT')
    }
    const parameters = definition.inputSchema as TSchema
    try {
      Compile(parameters)
    } catch {
      throw new Error('AGENT_MCP_TOOL_SCHEMA_INVALID')
    }
    originalNames.set(encodedName, definition.name)
    return {
      name: encodedName,
      label: definition.title || definition.name,
      description: definition.description || definition.title || definition.name,
      parameters,
      executionMode: 'sequential',
      execute: async (toolCallID, params, signal) => {
        const result = await invoke(
          definition,
          params as Record<string, unknown>,
          signal,
          toolCallID,
        )
        return {
          content: projectMCPContent(result, toolCallID),
          details: {
            kind: 'mcp',
            originalToolName: definition.name,
            result,
            ...(definition.annotations?.readOnlyHint === true ? { readOnly: true } : {}),
          } satisfies MCPToolDetails,
        } satisfies AgentToolResult<MCPToolDetails>
      },
    }
  })
  return { tools, originalNames }
}

export function createSerialToolInvoker(invoke: MCPToolInvoker): MCPToolInvoker {
  let tail: Promise<void> = Promise.resolve()
  return (definition, args, signal, toolCallID) => {
    const operation = tail.then(async () => {
      if (signal?.aborted) {
        throw new DOMException('工具调用已取消', 'AbortError')
      }
      return await invoke(definition, args, signal, toolCallID)
    })
    tail = operation.then(() => undefined, () => undefined)
    return operation
  }
}

export function createExactEndpointFetch(
  endpoint: URL,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const target = requestURL(input)
    if (target.origin !== endpoint.origin
      || target.pathname !== endpoint.pathname
      || target.search !== endpoint.search
      || target.hash !== ''
      || target.username
      || target.password) {
      throw new Error('AGENT_MCP_ENDPOINT_VIOLATION')
    }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    return await fetchImplementation(input, {
      ...init,
      ...(method.toUpperCase() === 'DELETE' ? { signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(signal ? [signal] : [])]) } : {}),
      cache: 'no-store',
      redirect: 'manual',
    })
  }
}

function resolveMCPEndpoint(coreBaseURL: string, value: string) {
  const core = new URL(coreBaseURL)
  const endpoint = new URL(value, core)
  if (core.protocol !== 'http:'
    || !loopbackHost(core.hostname)
    || endpoint.origin !== core.origin
    || endpoint.pathname !== '/mcp'
    || endpoint.search
    || endpoint.hash
    || endpoint.username
    || endpoint.password) {
    throw new Error('AGENT_MCP_ENDPOINT_INVALID')
  }
  return endpoint
}

function loopbackHost(value: string) {
  const host = value.toLowerCase()
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '[::1]'
    || host === '::1'
}

function validEncodedToolName(value: string) {
  return value.length > 2
    && value.length <= maximumEncodedToolNameLength
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function requestURL(input: RequestInfo | URL) {
  if (input instanceof URL) {
    return input
  }
  if (typeof input === 'string') {
    return new URL(input)
  }
  return new URL(input.url)
}

function projectMCPContent(result: CallToolResult, toolCallID: string) {
  const content: AgentToolResult<unknown>['content'] = []
  for (const block of result.content) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      content.push({ type: 'image', data: block.data, mimeType: block.mimeType })
    } else {
      content.push({ type: 'text', text: JSON.stringify(block) })
    }
  }
  const imageReferences = content.flatMap((block, index) => {
    const reference = block.type === 'image' && isAgentDisplayImageMIMEType(block.mimeType)
      ? agentToolImageReference(toolCallID, index) : undefined
    return reference ? [reference] : []
  })
  if (imageReferences.length > 0) {
    // 仅在本地 Agent 结果中追加引用说明，保留 MCP 原始结果和内容索引，正文不写入 Markdown。
    content.push({ type: 'text', text: [
      '以上图片的会话内引用（与图片顺序一致）：', ...imageReferences,
      '需要在回答或结论中展示图片时，使用 ![图片说明](对应引用)。直接引用已有图片，不重抄图片数据，不将引用作为工具参数。',
    ].join('\n') })
  }
  if (content.length === 0 && result.structuredContent !== undefined) {
    content.push({ type: 'text', text: JSON.stringify(result.structuredContent) })
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: '工具调用未返回内容' })
  }
  return content
}
