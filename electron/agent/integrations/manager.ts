import { Compile } from 'typebox/compile'
import type { TSchema } from 'typebox'
import type { IntegrationCorePort, IntegrationRunContext, IntegrationToolDefinition } from '../contracts/integrations.ts'
import { IntegrationConnections, type IntegrationConnectionOptions } from './connections.ts'
import { IntegrationOAuth } from './oauth.ts'
import { executeIntegrationCall, receiptResult } from './receipts.ts'
import { integrationResources, readIntegrationResource } from './resources.ts'
import { createHash } from 'node:crypto'
import type { IntegrationDirectory } from '../contracts/integrationIPC.ts'

export class IntegrationManager {
  private readonly connections: IntegrationConnections
  private readonly core: IntegrationCorePort
  private readonly oauth: IntegrationOAuth
  constructor(core: IntegrationCorePort, options: IntegrationConnectionOptions) {
    this.core = core
    this.oauth = new IntegrationOAuth(core, options.fetch)
    this.connections = new IntegrationConnections({ ...options, authProvider: config => this.oauth.provider(config) })
  }

  async login(source: string, revision: number, open: (url: string) => Promise<void>, signal?: AbortSignal) {
    await this.connections.invalidate(source)
    return this.oauth.login(source, revision, open, signal)
  }

  async directory(context: IntegrationRunContext, signal?: AbortSignal, knownFingerprint?:string) {
    const sources = await this.core.sources(context, signal)
    const unavailable = await this.connections.refresh(context.run_id,config=>sources.some(source=>source.id===config.source.id && source.revision===config.source.revision),
      (config,tools)=>this.core.saveTools(config.source.id,config.source.revision,tools,signal),signal)
    const directory: IntegrationDirectory = {sources: [], tools: []}
    let bytes = 0
    for (const source of sources) {
      const entry = {id:source.id,name:source.name,kind:source.kind,revision:source.revision,
        ...(source.skill ? {skill:source.skill,skill_selected:source.skill_selected} : {})}
      let tools: IntegrationDirectory['tools'] = []
      let reason = unavailable.get(source.id)
      if (source.kind === 'mcp' && !reason) {
        try { tools = await this.core.tools(source.id, source.revision, signal) }
        catch { signal?.throwIfAborted(); reason = 'INTEGRATION_DIRECTORY_UNAVAILABLE' }
      }
      const size = Buffer.byteLength(JSON.stringify({entry,tools}))
      // 目录不能突破 IPC 和运行工作集预算；超限来源保留明确状态，不能静默消失。
      if (bytes + size > 4 * 1024 * 1024 || directory.tools.length + tools.length > 4096) reason = 'INTEGRATION_DIRECTORY_CAPACITY'
      directory.sources.push(reason ? {...entry,skill:undefined,unavailable_reason:reason,tool_count:tools.length} : entry)
      if (!reason) { bytes += size; directory.tools.push(...tools) }
    }
    const fingerprint=createHash('sha256').update(JSON.stringify(directory)).digest('hex')
    return knownFingerprint===fingerprint ? {unchanged:true as const} : {...directory,fingerprint}
  }

  async definition(context: IntegrationRunContext, source: string, revision: number, name: string, signal?: AbortSignal) {
    await this.allowed(context, source, revision, signal)
    return this.core.tool(source, revision, name, signal)
  }

  async content(context: IntegrationRunContext, id: string, offset: number, signal?: AbortSignal) {
    const result = await this.core.readContent(context, id, offset, signal)
    const media = result.resource.mime_type.split(';', 1)[0].trim().toLowerCase()
    const text = media.startsWith('text/') || ['application/json', 'application/yaml', 'application/xml'].includes(media)
    return { ...result, data:undefined, ...(text ? {text:Buffer.from(result.data,'base64').toString('utf8')} : {message:'Binary resource retained. This reader returns text only; do not interpret or execute binary data.'}) }
  }
  skill(context: IntegrationRunContext, source: string, version: string, path: string, offset: number, toolCallID: string, signal?: AbortSignal) {
    return this.core.skill(context, source, version, path, offset, toolCallID, signal)
  }

  receipt(context: IntegrationRunContext, toolCallID: string, signal?: AbortSignal) { return this.core.receipt(context,toolCallID,undefined,signal) }
  async resources(context: IntegrationRunContext, input: {source:string;revision:number;kind:'resources' | 'templates';cursor?:string}, signal?:AbortSignal) {
    await this.allowed(context,input.source,input.revision,signal)
    return integrationResources(this.core,this.connections,context,input,signal)
  }
  async readResource(context: IntegrationRunContext, input:{source:string;revision:number;uri:string;tool_call_id:string}, signal?:AbortSignal) {
    await this.allowed(context,input.source,input.revision,signal)
    return readIntegrationResource(this.core,this.connections,context,input,signal)
  }

  async test(source: string, revision: number, signal?: AbortSignal) {
    const config = await this.core.config(source, revision, signal)
    const owner = `test:${source}`
    try {
      const connection = await this.connections.acquire(config, owner, owner, signal)
      await this.core.saveTools(source, revision, connection.directory, signal)
      return { tools: connection.directory.map(tool=>({source_id:tool.source_id,source_revision:tool.source_revision,name:tool.name,title:tool.title,
        description:tool.description,contract_hash:tool.contract_hash,unavailable_reason:tool.unavailable_reason})), generation: connection.generation }
    } finally { this.connections.release(owner) }
  }

  status() { return this.connections.status() }
  async reconnect(source: string, revision: number, signal?: AbortSignal) {
    await this.invalidate(source)
    return this.test(source, revision, signal)
  }

  async call(context: IntegrationRunContext, source: string, revision: number, name: string, toolCallID: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const previous = await this.core.receipt(context, toolCallID, {source_id:source,revision,tool:name,arguments:args}, signal)
    if (previous && (previous.state !== 'prepared' || previous.generation !== undefined && previous.generation !== context.generation)) return receiptResult(previous)
    const definition = await this.definition(context, source, revision, name, signal)
    if (definition.unavailable_reason || !Compile(definition.input_schema as TSchema).Check(args)) throw new Error('INTEGRATION_ARGUMENTS_INVALID')
    const config = await this.core.config(source, revision, signal)
    const connection = await this.connections.acquire(config, context.session_id, context.run_id, signal)
    const actual = connection.directory.find(tool => tool.name === name)
    this.sameContract(definition, actual)
    const receipt = await this.core.authorize(context, definition, toolCallID, args, signal)
    return executeIntegrationCall(this.core,context,receipt,connection.generation,mark => this.connections.call(connection,definition,args,signal,
      () => this.core.verifyDispatch(context,receipt.id,signal),mark),signal)
  }

  release(run: string) { this.connections.release(run) }
  invalidate(source: string) { this.oauth.invalidate(source); return this.connections.invalidate(source) }
  close() { this.oauth.close(); return this.connections.close() }

  private async allowed(context: IntegrationRunContext, source: string, revision: number, signal?: AbortSignal) {
    if (!(await this.core.sources(context, signal)).some(item => item.id === source && item.revision === revision)) throw new Error('INTEGRATION_SOURCE_UNAVAILABLE')
  }

  private sameContract(expected: IntegrationToolDefinition, actual: IntegrationToolDefinition | undefined) {
    if (!actual || actual.contract_hash !== expected.contract_hash || actual.unavailable_reason) throw new Error('INTEGRATION_TOOL_CHANGED')
  }
}
