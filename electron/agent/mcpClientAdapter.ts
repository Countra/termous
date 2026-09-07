import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool as MCPTool,
} from '@modelcontextprotocol/client'
import type { TSchema } from 'typebox'
import { Compile } from 'typebox/compile'
import { encodeMCPToolName } from './toolNameCodec.ts'

export const agentMCPProtocolVersion = '2025-11-25'
export const expectedAgentMCPToolCount = 76

const mcpConnectTimeoutMs = 15_000
const mcpToolTimeoutMs = 10 * 60_000
const maximumEncodedToolNameLength = 64

export interface MCPToolDetails {
  kind: 'mcp'
  originalToolName: string
  result: CallToolResult
}

export interface AgentMCPConnection {
  tools: AgentTool[]
  originalName(encodedName: string): string | null
  close(): Promise<void>
}

export interface ConnectAgentMCPOptions {
  coreBaseURL: string
  endpoint: string
  bearerToken: string
  protocolVersion: string
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  expectedToolCount?: number
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
    const expectedCount = options.expectedToolCount ?? expectedAgentMCPToolCount
    const invocation = createSerialToolInvoker(async (definition, args, signal) => {
      return await client.callTool(
        { name: definition.name, arguments: args },
        {
          signal,
          timeout: mcpToolTimeoutMs,
          maxTotalTimeout: mcpToolTimeoutMs,
          toolDefinition: definition,
        },
      )
    })
    const mapped = mapMCPTools(listed.tools, invocation, expectedCount)
    return {
      tools: mapped.tools,
      originalName: (encodedName) => mapped.originalNames.get(encodedName) ?? null,
      close: async () => {
        await client.close()
      },
    }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}

export type MCPToolInvoker = (
  definition: MCPTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<CallToolResult>

export function mapMCPTools(
  definitions: MCPTool[],
  invoke: MCPToolInvoker,
  expectedCount = expectedAgentMCPToolCount,
) {
  if (definitions.length !== expectedCount) {
    throw new Error('AGENT_MCP_TOOL_COUNT_MISMATCH')
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
      execute: async (_toolCallID, params, signal) => {
        const result = await invoke(
          definition,
          params as Record<string, unknown>,
          signal,
        )
        return {
          content: projectMCPContent(result),
          details: {
            kind: 'mcp',
            originalToolName: definition.name,
            result,
          } satisfies MCPToolDetails,
        } satisfies AgentToolResult<MCPToolDetails>
      },
    }
  })
  return { tools, originalNames }
}

export function createSerialToolInvoker(invoke: MCPToolInvoker): MCPToolInvoker {
  let tail: Promise<void> = Promise.resolve()
  return (definition, args, signal) => {
    const operation = tail.then(async () => {
      if (signal?.aborted) {
        throw new DOMException('工具调用已取消', 'AbortError')
      }
      return await invoke(definition, args, signal)
    })
    tail = operation.then(() => undefined, () => undefined)
    return operation
  }
}

export function isMCPToolDetails(value: unknown): value is MCPToolDetails {
  return typeof value === 'object'
    && value !== null
    && (value as { kind?: unknown }).kind === 'mcp'
    && typeof (value as { originalToolName?: unknown }).originalToolName === 'string'
    && typeof (value as { result?: unknown }).result === 'object'
    && (value as { result?: unknown }).result !== null
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
    return await fetchImplementation(input, {
      ...init,
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

function projectMCPContent(result: CallToolResult) {
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
  if (content.length === 0 && result.structuredContent !== undefined) {
    content.push({ type: 'text', text: JSON.stringify(result.structuredContent) })
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: '工具调用未返回内容' })
  }
  return content
}
