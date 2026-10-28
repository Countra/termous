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
import { ResourceRoutingError } from '../../contracts/toolRecovery.ts'
import type { DesktopObservationState } from '../../contracts/desktopObservation.ts'
import { projectManagedRecovery } from '../recovery/preparation.ts'
import { prepareDesktopExecution } from './desktopBatch/query.ts'
import { observeDesktopBatch } from './desktopBatch/receipt.ts'
import { reconcileDesktopBatch } from './desktopBatch/reconcile.ts'

export interface ManagedToolOptions {
  runID: string
  generation: number
  bindings?: RuntimeResourceBinding[]
  desktop?: DesktopObservationState
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
          name, signal, bindings: options.bindings ?? [], desktop: options.desktop, has: (field) => field in toolProperties(tool),
          read: (key) => snapshots.read(key), remember: (key, value) => snapshots.remember(key, value), forget: (key) => snapshots.forget(key), lookup,
          invoke: async (next, args, step) => {
            progress(next === 'termous.desktops.control.acquire' ? 'waiting' : 'preparing')
            const result = await invoke(next, args, step)
            signal?.throwIfAborted()
            const output = body(result)
            // 中间查询尚未通过业务复验，不能提前替换默认目标；成功附着才确认新的观察身份。
            observe({ ...context, name: next, desktop: next === 'termous.desktops.attach' ? context.desktop : undefined }, args, output)
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
          if ('client_request_id' in properties && !['termous.desktops.operations.get', 'termous.desktops.executions.get', 'termous.desktops.executions.cancel'].includes(target)) args.client_request_id = requestIdentity(options.runID, options.generation, callID, step)
          if (mutating) {
            const previous = await lookup(callID, step)
            if (previous) {
              if (previous.generation !== options.generation) fail('AGENT_EXECUTION_CHANGED', 'A previous execution may already have dispatched this action. Query its original receipt.', 'query_operation')
              if (previous.tool_name !== target || previous.arguments_sha256 !== digest) fail('AGENT_REQUEST_CONFLICT', 'This call identity is already bound to different parameters.')
              args = restorePreparedValues(args, previous.values)
            }
          }
          let validated: unknown
          try { validated = next.prepareArguments ? next.prepareArguments(args) : args } catch (error) {
            if (!(error instanceof ResourceRoutingError) || error.failure.dispatched) throw error
            const failure = error.failure
            fail(failure.code, failure.message, failure.required_tool
              ? { kind: 'reread', tool: failure.required_tool, arguments: failure.required_arguments }
              : 'correct_parameters', failure)
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
            if (target === 'termous.desktops.execute') {
              const receipt = await reconcileDesktopBatch(raw.get('termous.desktops.executions.get'), callID, String(args.client_request_id), signal, update)
              if (receipt) return receipt
            }
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
            // 恢复记录已保存原批次标识；前端别名不能再次透传给 Core。
            if (adapter.adapter === 'desktop_execution') delete args.tool_call_id
          } else {
            switch (adapter.adapter) {
              case 'desktop': await prepareDesktop(context, args); break
              case 'desktop_execution': await prepareDesktopExecution(context, args); break
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
                  return projectManagedRecovery({ content, details: { kind: 'mcp', originalToolName: name, result: { content, structuredContent: output } } }, context, String(args.tool_call_id))
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
          const result = previous && name === 'termous.desktops.execute'
            ? await reconcileDesktopBatch(raw.get('termous.desktops.executions.get'), callID, previous.request_id, signal, update) ?? unconfirmedDispatch(name, callID, args)
            : await invoke(name, args, 'dispatch', digest)
          signal?.throwIfAborted()
          if (isMCPToolDetails(result.details) && isRecord(result.details.result.structuredContent)
            && (name === 'termous.desktops.execute' || adapter.adapter === 'desktop_execution')) observeDesktopBatch(context, result.details.result.structuredContent)
          if (isMCPToolDetails(result.details) && !result.details.result.isError && isRecord(result.details.result.structuredContent) && !result.details.result.structuredContent.error) observe(context, args, result.details.result.structuredContent)
          const projected = projectManagedRecovery(result, context, String(input.tool_call_id ?? callID))
          return options.desktop && ['desktop', 'analysis', 'workflow'].includes(adapter.adapter) ? options.desktop.project(projected) : projected
        } catch (error) {
          if (!(error instanceof PreparationStopped)) throw error
          const result = projectManagedRecovery(error.result, context, callID)
          const projected = isMCPToolDetails(result.details) ? { ...result, details: { ...result.details, originalToolName: name } } : result
          return options.desktop && !signal?.aborted && ['desktop', 'analysis', 'workflow'].includes(adapter.adapter) ? options.desktop.project(projected) : projected
        } finally { prepared.clear() }
      },
    } satisfies AgentTool
  })
}

function observe(ctx: PreparationContext, args: Arguments, output: Arguments) {
  ctx.desktop?.observe(ctx.name, args, output)
  observeDesktop(ctx, args, output)
  observeWorkflow(ctx, output)
  observeRevisions(ctx, args, output)
}
