import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { IntegrationDirectory } from '../contracts/integrationIPC.ts'
import type { IntegrationToolResult } from '#common/agent-integrations'
import { identifyTool, localToolSource } from '../contracts/toolSources.ts'
import type { WorkerIntegrationProxy } from './integrationProxy.ts'

export function integrationResourceTools(directory: IntegrationDirectory, proxy: WorkerIntegrationProxy): AgentTool[] {
  const sources = directory.sources.filter(source => source.kind === 'mcp')
  const findSource = (id: string) => {
    const source = sources.find(source => source.id === id)
    if (!source) throw new Error('INTEGRATION_SOURCE_UNAVAILABLE')
    return source
  }
  const tools: AgentTool[] = [{ name: 'read_integration_resource', label: '读取扩展资源',
    description: 'Read up to 32 KiB of a saved external result using its resource id and byte offset. Never executes content or fetches URLs.',
    parameters: Type.Object({ id: Type.String({ minLength: 1, maxLength: 128 }), offset: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const input = args as { id: string; offset?: number }
      const result = await proxy.request<{text?: string; data?: string; next_offset: number; done: boolean}>({ action: 'content', id: input.id, offset: input.offset ?? 0 }, signal)
      return jsonResult(result)
    },
  }, {
    name: 'list_integration_sources', label: '查看外部扩展状态',
    description: 'List external sources, including connection, directory and capacity failures. Reconnect in Assistant extensions settings. Never repeat uncertain operations.',
    parameters: Type.Object({}, {additionalProperties:false}),
    execute: async () => ({content:[{type:'text' as const,text:JSON.stringify({status:directory.status,sources:directory.sources.map(({id,name,kind,revision,unavailable_reason,tool_count})=>({id,name,kind,revision,unavailable_reason,tool_count}))})}],details:{kind:'integration_sources'}}),
  }, {
    name: 'list_mcp_resources', label: '浏览外部 MCP 资源',
    description: 'Browse resources or templates without reading content. Get source IDs from list_integration_sources. Keep the same source and kind when paging.',
    parameters: Type.Object({source:Type.String(),kind:Type.Optional(Type.Union([Type.Literal('resources'),Type.Literal('templates')])),cursor:Type.Optional(Type.String({maxLength:8192}))},{additionalProperties:false}),
    execute: async (_id,args,signal) => {
      const input = args as {source:string;kind?:'resources' | 'templates';cursor?:string}
      const source = findSource(input.source)
      const result = await proxy.request({action:'resources',source:source.id,revision:source.revision,kind:input.kind ?? 'resources',cursor:input.cursor},signal)
      return jsonResult(result)
    },
  }, {
    name: 'read_mcp_resource', label: '读取外部 MCP 资源',
    description: 'Read a URI through its MCP source with separate approval. For templates, supply the completed URI. Never fetch returned URLs directly or execute scripts.',
    parameters:Type.Object({source:Type.String(),uri:Type.String({minLength:1,maxLength:8192})},{additionalProperties:false}),
    execute:async (id,args,signal) => {
      const input=args as {source:string;uri:string}
      const source=findSource(input.source)
      const result=await proxy.request<IntegrationToolResult>({action:'read_resource',source:source.id,revision:source.revision,uri:input.uri,tool_call_id:id},signal)
      return {content:result.content,isError:result.isError,details:{kind:'integration_resource',operation:result.operation}}
    },
  }, {
    name:'query_external_operation',label:'查询外部调用回执',
    description:'Read this run’s external call receipt by its original tool_call_id, even if the source is disabled or disconnected. Never retries the operation.',
    parameters:Type.Object({tool_call_id:Type.String({minLength:1,maxLength:256})},{additionalProperties:false}),
    execute:async (_id,args,signal) => {
      const result=await proxy.request({action:'receipt',tool_call_id:(args as {tool_call_id:string}).tool_call_id},signal)
      return jsonResult(result)
    },
  }]
  return tools.map(tool => identifyTool(tool,localToolSource))
}

function jsonResult(value:unknown) {
  return {content:[{type:'text' as const,text:JSON.stringify(value)}],details:{kind:'integration_resource'}}
}
