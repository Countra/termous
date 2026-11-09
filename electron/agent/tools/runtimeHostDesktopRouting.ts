import { ResourceRoutingError } from '../contracts/toolRecovery.ts'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { hostDesktopTargetKey, isHostDesktopTarget } from '#common/contracts'
import { isMCPToolDetails, type AgentMCPConnection } from '../contracts/mcpTools.ts'
import type { RuntimeHostDesktopBinding } from '../contracts/runtimeDesktopBinding.ts'
import { builtinTool } from '../contracts/toolSources.ts'
import { isRecord } from '../contracts/validation.ts'

interface AttachmentReceipt { usable: boolean; detached: boolean; revision: number }

// 只信任本轮工具响应建立的来源和附着；模型或历史记录不能自行恢复授权链。
export function bindRuntimeHostDesktopTools(mcp: AgentMCPConnection, binding: RuntimeHostDesktopBinding): AgentTool[] {
  const target = binding.desktop_target
  const matches = (value: unknown) => isHostDesktopTarget(value) && hostDesktopTargetKey(value) === hostDesktopTargetKey(target)
  const attachments = new Map<string, AttachmentReceipt>()
  let sourceReady = false
  let sourceRevision = 0
  let revision = 0
  let retiredRevision = 0
  const reject = (discovery = false): never => {
    throw new ResourceRoutingError({ code: 'AGENT_RESOURCE_BINDING_MISMATCH', dispatched: false,
      message: '本轮本机来源或附着尚未核验，未派发。使用精确实例、来源与代次重新观察；失效时要求重新选择，不能更换显示器或重放不确定输入。',
      ...(discovery ? { required_tool: 'termous.desktops.sources', required_arguments: { kind: target.host.kind } } : {}),
    })
  }
  const remember = (id: string, receipt: AttachmentReceipt) => {
    if (receipt.revision <= retiredRevision || (attachments.get(id)?.revision ?? 0) > receipt.revision) return
    attachments.delete(id)
    attachments.set(id, receipt)
    while (attachments.size > 256) {
      const first = attachments.keys().next().value!
      retiredRevision = Math.max(retiredRevision, attachments.get(first)!.revision)
      attachments.delete(first)
    }
  }
  return mcp.tools.map(tool => {
    const name = mcp.originalName(tool.name) ?? ''
    if (!builtinTool(tool) || !name.startsWith('termous.desktops.') && !name.startsWith('termous.desktop_workflows.')) return tool
    const validate = (args: unknown) => {
      if (!isRecord(args)) return
      if (args.session_id !== undefined || args.profile_id !== undefined || args.connection_generation !== undefined
        || name === 'termous.desktops.connect' || name === 'termous.desktops.close') reject()
      if (name === 'termous.desktops.sources' && args.kind !== target.host.kind) reject()
      if (name === 'termous.desktops.attach' || name === 'termous.desktop_workflows.runs.start') {
        if (!matches(args.target)) reject()
        if (!sourceReady) reject(true)
      }
      if ('attachment_id' in args) {
        const receipt = typeof args.attachment_id === 'string' ? attachments.get(args.attachment_id) : undefined
        const cleanup = ['termous.desktops.get', 'termous.desktops.detach', 'termous.desktops.control.release', 'termous.desktops.operations.get'].includes(name)
        if (!receipt || receipt.detached || !cleanup && !receipt.usable) reject(true)
      }
    }
    return { ...tool,
      prepareArguments: args => {
        const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args
        validate(prepared)
        return prepared
      },
      execute: async (id, args, signal, update) => {
        validate(args)
        const current = ++revision
        if (name === 'termous.desktops.sources') { sourceReady = false; sourceRevision = current }
        const old = isRecord(args) && typeof args.attachment_id === 'string' ? attachments.get(args.attachment_id) : undefined
        if (old && isRecord(args) && ['termous.desktops.get', 'termous.desktops.detach'].includes(name)) {
          remember(String(args.attachment_id), { ...old, usable: false, revision: current })
        }
        const result = await tool.execute(id, args, signal, update)
        if (!isMCPToolDetails(result.details) || result.details.result.isError) return result
        const output = result.details.result.structuredContent
        if (!isRecord(output) || output.error) return result
        if (name === 'termous.desktops.sources' && current === sourceRevision) {
          sourceReady = Array.isArray(output.sources) && output.sources.some(value => isRecord(value) && matches(value.target))
        }
        const attachment = isRecord(output.control) ? output.control.attachment : output.attachment
        if (isRecord(attachment) && typeof attachment.id === 'string' && matches(attachment.target)
          && isRecord(args) && (name === 'termous.desktops.attach' || attachment.id === args.attachment_id)
          && !attachments.get(attachment.id)?.detached) {
          remember(attachment.id, { usable: attachment.state === 'ready', detached: false, revision: current })
        }
        if (old && isRecord(args) && name === 'termous.desktops.detach' && output.completed) {
          remember(String(args.attachment_id), { usable: false, detached: true, revision: ++revision })
        }
        return result
      },
    }
  })
}
