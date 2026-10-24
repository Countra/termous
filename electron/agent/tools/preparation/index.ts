import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Compile } from 'typebox/compile'
import catalog from '../../contracts/capabilities.generated.json' with { type: 'json' }
import type { BuiltinToolAdapter } from '../../contracts/toolCapabilities.ts'
import type { AgentMCPConnection } from '../../contracts/mcpTools.ts'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import { isRecord } from '../../contracts/validation.ts'
import type { RuntimeResourceBinding } from '../../contracts/resourceBindings.ts'
import { body, fail, PreparationStopped, toolProperties, type Arguments, type PreparedCall, type PreparationContext } from './contracts.ts'
import { builtinSchema } from './schema.ts'
import { argumentDigest, PreparationSnapshots, preparedValues, requestIdentity, restorePreparedValues } from './identity.ts'
import { desktopAttachment, observeDesktop, prepareDesktop } from './desktop.ts'
import { prepareSSH } from './ssh.ts'
import { prepareFiles } from './files.ts'
import { observeWorkflow, prepareWorkflow } from './workflow.ts'
import { observeRevisions, prepareRevisions } from './revisions.ts'
import { unconfirmedDispatch } from './dispatch.ts'
import { builtinDescription } from './description.ts'
import { validateArguments } from './validation.ts'
import { builtinTool } from '../../contracts/toolSources.ts'

export interface ManagedToolOptions {
  runID: string
  generation: number
  bindings?: RuntimeResourceBinding[]
  blocked?(name: string, args: Arguments): string | undefined
  persist(call: PreparedCall): Promise<void>
  progress?(callID: string, name: string, phase: 'preparing' | 'waiting' | 'executing'): void
  lookup(callID: string, step: string, signal?: AbortSignal): Promise<PreparedCall | undefined>
}

export function prepareBuiltinTools(mcp: AgentMCPConnection, options: ManagedToolOptions): AgentTool[] {
  const raw = new Map(mcp.tools.filter(builtinTool).map((tool) => [mcp.originalName(tool.name) ?? tool.name, tool]))
  const snapshots = new PreparationSnapshots()
  const adapters = catalog.builtin.tools as Record<string, BuiltinToolAdapter>
  return mcp.tools.map((tool) => {
    if (!builtinTool(tool)) return tool
    const name = mcp.originalName(tool.name) ?? tool.name
    const adapter = adapters[name]
    if (!adapter) throw new Error(`AGENT_TOOL_ADAPTER_UNDECLARED: ${name}`)
    const schema = builtinSchema(tool, adapter)
    const modelValidator = Compile(schema)
    return { ...tool, parameters: schema, prepareArguments: undefined,
      description: builtinDescription(name, tool.description, adapter),
      execute: async (callID, input, signal, update) => {
        const prepared = new Map<string, PreparedCall>()
        let phase = ''
        const progress = (next: 'preparing' | 'waiting' | 'executing') => {
          if (next !== phase) { phase = next; options.progress?.(callID, name, next) }
        }
        const lookup = async (id: string, step: string) => id === callID && prepared.has(step) ? prepared.get(step) : options.lookup(id, step, signal)
        const context: PreparationContext = {
          name, signal, bindings: options.bindings ?? [], has: (field) => field in toolProperties(tool),
          read: (key) => snapshots.read(key), remember: (key, value) => snapshots.remember(key, value), forget: (key) => snapshots.forget(key), lookup,
          invoke: async (next, args, step) => {
            progress(next === 'termous.desktops.control.acquire' ? 'waiting' : 'preparing')
            const result = await invoke(next, args, step)
            const output = body(result)
            observe({ ...context, name: next }, args, output)
            return output
          },
        }
        const invoke = async (target: string, input: Arguments, step: string, digest = argumentDigest(input)): Promise<AgentToolResult<unknown>> => {
          signal?.throwIfAborted()
          const next = raw.get(target)
          if (!next) fail('AGENT_PREPARATION_PERMISSION_REQUIRED', `The required tool ${target} is not available under current permissions.`, 'user_action')
          const blocked = options.blocked?.(target, input)
          if (blocked) fail('AGENT_PREPARATION_BLOCKED', blocked, 'user_action')
          let args = { ...input }
          const properties = toolProperties(next)
          const mutating = mcp.readOnly?.(target) !== true
          if ('client_request_id' in properties && target !== 'termous.desktops.operations.get') args.client_request_id = requestIdentity(options.runID, options.generation, callID, step)
          if (mutating) {
            const previous = await lookup(callID, step)
            if (previous) {
              if (previous.generation !== options.generation) fail('AGENT_EXECUTION_CHANGED', 'A previous execution may already have dispatched this action. Query its original receipt.', 'query_operation')
              if (previous.tool_name !== target || previous.arguments_sha256 !== digest) fail('AGENT_REQUEST_CONFLICT', 'This call identity is already bound to different parameters.')
              args = restorePreparedValues(args, previous.values)
            }
          }
          let validated: unknown
          try { validated = next.prepareArguments ? next.prepareArguments(args) : args } catch {
            fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The prepared target no longer satisfies this execution binding. Read the current target and correct the selection.', 'reread')
          }
          validateArguments(Compile(next.parameters), validated, `Prepared parameters do not satisfy ${target}; inspect the indicated business fields.`)
          if (mutating && !prepared.has(step)) {
            const record: PreparedCall = { tool_call_id: callID, tool_name: target, step, request_id: String(args.client_request_id ?? requestIdentity(options.runID, options.generation, callID, step)), arguments_sha256: digest, values: preparedValues(args), generation: options.generation }
            // 记录提交失败时禁止派发；记录只在当前调用内驻留，历史按需读取。
            await options.persist(record)
            prepared.set(step, record)
          }
          try { return await next.execute(callID, validated, signal, update) } catch (error) {
            if (!mutating) throw error
            return unconfirmedDispatch(target, callID, args)
          }
        }
        try {
          validateArguments(modelValidator, input, 'The request does not match the current simplified tool schema; correct the indicated fields.')
          if (!isRecord(input)) fail('AGENT_PARAMETER_INVALID', 'The tool request must be an object.')
          const args: Arguments = { ...input }
          const digest = argumentDigest(input)
          const previous = mcp.readOnly?.(name) !== true ? await lookup(callID, 'dispatch') : undefined
          if (previous) {
            if (previous.generation !== options.generation || previous.tool_name !== name || previous.arguments_sha256 !== digest) fail('AGENT_REQUEST_CONFLICT', 'This action was already prepared in another execution or with different arguments. Query its original result.', 'query_operation')
            restorePreparedValues(args, previous.values)
          } else {
            switch (adapter.adapter) {
              case 'desktop': await prepareDesktop(context, args); break
              case 'workflow': await prepareWorkflow(context, args); break
              case 'ssh': await prepareSSH(context, args); break
              case 'files': await prepareFiles(context, args); break
              case 'analysis':
                if (name.endsWith('.create') && args.source === undefined) args.source = { kind: 'attachment', id: (await desktopAttachment(context, {})).id }
                break
              case 'operation': {
                const original = await lookup(String(args.tool_call_id), 'dispatch')
                if (!original || !original.tool_name.startsWith('termous.desktops.') || !original.values.grant_id) fail('AGENT_OPERATION_NOT_FOUND', 'No original desktop input is registered for this tool_call_id.', 'user_action')
                if (original.operation_result && ['accepted', 'failed', 'uncertain'].includes(String(original.operation_result.state))) {
                  const output = { operation: original.operation_result }
                  const content = [{ type: 'text' as const, text: JSON.stringify(output) }]
                  return projectRecovery({ content, details: { kind: 'mcp', originalToolName: name, result: { content, structuredContent: output } } }, String(args.tool_call_id))
                }
                if (original.generation !== options.generation) fail('AGENT_OPERATION_OUTCOME_UNAVAILABLE', 'The previous execution ended without a confirmed receipt. Its input authority cannot be restored. Observe the desktop without replaying the action.', 'user_action')
                args.attachment_id = original.values.attachment_id
                args.client_request_id = original.request_id
                delete args.tool_call_id
                break
              }
            }
            prepareRevisions(context, args)
          }
          progress('executing')
          const result = await invoke(name, args, 'dispatch', digest)
          if (isMCPToolDetails(result.details) && !result.details.result.isError && isRecord(result.details.result.structuredContent) && !result.details.result.structuredContent.error) observe(context, args, result.details.result.structuredContent)
          return projectRecovery(result, String(input.tool_call_id ?? callID))
        } catch (error) {
          if (!(error instanceof PreparationStopped)) throw error
          const result = error.result
          return isMCPToolDetails(result.details) ? { ...result, details: { ...result.details, originalToolName: name } } : result
        } finally { prepared.clear() }
      },
    } satisfies AgentTool
  })
}

function projectRecovery(result: AgentToolResult<unknown>, callID: string): AgentToolResult<unknown> {
  if (!isMCPToolDetails(result.details)) return result
  const output = result.details.result.structuredContent
  if (!isRecord(output)) return result
  const key = isRecord(output.operation) ? 'operation' : 'error'
  const value = output[key]
  if (!isRecord(value) || !isRecord(value.execution) || !isRecord(value.execution.recovery) || value.execution.recovery.tool !== 'termous.desktops.operations.get') return result
  const projected = { ...output, [key]: { ...value, execution: { ...value.execution,
    recovery: { ...value.execution.recovery, arguments: { tool_call_id: callID } },
  } } }
  const content = [{ type: 'text' as const, text: JSON.stringify(projected) }]
  return { ...result, content, details: { ...result.details, result: { ...result.details.result, content, structuredContent: projected } } }
}

function observe(ctx: PreparationContext, args: Arguments, output: Arguments) {
  observeDesktop(ctx, args, output)
  observeWorkflow(ctx, output)
  observeRevisions(ctx, args, output)
}
