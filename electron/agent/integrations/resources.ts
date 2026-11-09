import type { ReadResourceResult } from '@earendil-works/pi-mcp'
import type { IntegrationCorePort, IntegrationRunContext } from '../contracts/integrations.ts'
import type { IntegrationConnections } from './connections.ts'
import { executeIntegrationCall, receiptResult } from './receipts.ts'

export async function integrationResources(core: IntegrationCorePort, connections: IntegrationConnections, context: IntegrationRunContext,
  input: {source: string; revision: number; kind: 'resources' | 'templates'; cursor?: string}, signal?: AbortSignal) {
  const config = await core.config(input.source, input.revision, signal)
  const connection = await connections.acquire(config, context.session_id, context.run_id, signal)
  if (!connection.client.serverCapabilities?.resources) throw new Error('INTEGRATION_RESOURCES_UNSUPPORTED')
  const method = input.kind === 'templates' ? 'resources/templates/list' : 'resources/list'
  return connections.execute(connection, 0, signal, async () => {
    const result = await connection.client.request<Record<string, unknown>>(method, input.cursor ? {cursor:input.cursor} : {}, {signal, timeoutMs: 15_000})
    if (Buffer.byteLength(JSON.stringify(result)) > 192 * 1024) throw new Error('INTEGRATION_RESOURCE_DIRECTORY_TOO_LARGE')
    const field = input.kind === 'templates' ? 'resourceTemplates' : 'resources'
    if (!Array.isArray(result[field]) || result[field].length > 1024) throw new Error('INTEGRATION_RESOURCE_DIRECTORY_INVALID')
    // 仅保留协议中的描述字段，远端元数据不进入可信导航。
    const entries = result[field].map((item: Record<string, unknown>) => ({uri:item.uri,uriTemplate:item.uriTemplate,name:item.name,
      title:item.title,description:item.description,mimeType:item.mimeType}))
    return {[field]:entries,nextCursor:result.nextCursor,connection_generation:connection.generation}
  })
}

export async function readIntegrationResource(core: IntegrationCorePort, connections: IntegrationConnections, context: IntegrationRunContext,
  input: {source: string; revision: number; uri: string; tool_call_id: string}, signal?: AbortSignal) {
  const previous = await core.receipt(context,input.tool_call_id,{kind:'resource',source_id:input.source,revision:input.revision,tool:'resources/read',arguments:{uri:input.uri}},signal)
  if (previous && (previous.state !== 'prepared' || previous.generation !== undefined && previous.generation !== context.generation)) return receiptResult(previous)
  const config = await core.config(input.source,input.revision,signal)
  const connection = await connections.acquire(config,context.session_id,context.run_id,signal)
  if (!connection.client.serverCapabilities?.resources) throw new Error('INTEGRATION_RESOURCES_UNSUPPORTED')
  const receipt = await core.authorizeResource(context,input.source,input.revision,input.tool_call_id,input.uri,signal)
  return executeIntegrationCall(core,context,receipt,connection.generation,mark => connections.execute(connection,Buffer.byteLength(input.uri),signal,async () => {
    await core.verifyDispatch(context,receipt.id,signal)
    signal?.throwIfAborted()
    if (connection.retired) throw new Error('INTEGRATION_CONFIG_CHANGED')
    // URI 只交给所属 MCP 来源，绝不由宿主当作网络地址读取。
    mark()
    const result = await connection.client.request<ReadResourceResult>('resources/read',{uri:input.uri},{signal, timeoutMs: 15_000})
    return {content:result.contents.map(resource => ({type:'resource' as const,resource}))}
  }),signal)
}
