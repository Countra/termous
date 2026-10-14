import type { AgentTool } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails, type AgentMCPConnection } from '../contracts/mcpTools.ts'
import { isRecord } from '../contracts/validation.ts'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'
import type { RuntimeDesktopBinding, RuntimeWorkflowBinding } from '../contracts/runtimeDesktopBinding.ts'

interface DesktopSessionRoute {
  generation?: number
  ready: boolean
  revision: number
}

interface DesktopAttachmentRoute {
  session: string
  generation: number
  usable: boolean
  revision: number
  detached?: boolean
}

// 运行内的附着身份只从本轮 MCP 成功响应建立，不接受历史消息中的 ID 充当授权链。
export function bindRuntimeDesktopTools(mcp: AgentMCPConnection, bindings: RuntimeResourceBinding[]): AgentTool[] {
  const desktop = bindings.find((v): v is RuntimeDesktopBinding => v.kind === 'desktop_session' || v.kind === 'desktop_profile')
  const workflow = bindings.find((v): v is RuntimeWorkflowBinding => v.kind === 'desktop_workflow')
  if (!desktop && !workflow) return mcp.tools
  const sessions = new Map<string, DesktopSessionRoute>()
  const attachments = new Map<string, DesktopAttachmentRoute>()
  let revision = 0
  const expectedTarget = desktop?.kind === 'desktop_session'
    ? { session_id: desktop.session_id, connection_generation: desktop.connection_generation }
    : desktop ? { profile_id: desktop.desktop_profile_id } : {}
  const reject = (expected: Record<string, unknown>) => {
    throw new Error(JSON.stringify({ code: 'AGENT_RESOURCE_BINDING_MISMATCH', dispatched: false,
      message: '调用目标与本轮引用不一致，尚未派发。请按精确引用修正参数；不要重放结果未知的操作。', expected_arguments: expected }))
  }
  const knownSession = (id: unknown, generation?: unknown, needsReady = true) => {
    const value = typeof id === 'string' ? sessions.get(id) : undefined
    return value?.generation !== undefined && (!needsReady || value.ready)
      && (generation === undefined || value.generation === generation)
  }
  const knownAttachment = (id: unknown) => {
    const value = typeof id === 'string' ? attachments.get(id) : undefined
    return value !== undefined && value.usable && knownSession(value.session, value.generation)
  }
  const observeSession = (value: unknown, currentRevision: number) => {
    if (!desktop || !isRecord(value) || typeof value.id !== 'string') return
    if ((sessions.get(value.id)?.revision ?? 0) > currentRevision) return
    if (value.profile_id !== desktop.desktop_profile_id || value.host_id !== desktop.host_id || value.protocol !== desktop.protocol
      || !Number.isSafeInteger(value.connection_generation) || Number(value.connection_generation) < 0
      || desktop.kind === 'desktop_session' && (value.id !== desktop.session_id || value.connection_generation !== desktop.connection_generation)) {
      sessions.set(value.id, { ready: false, revision: currentRevision })
      return
    }
    sessions.set(value.id, { generation: Number(value.connection_generation), revision: currentRevision,
      ready: Number(value.connection_generation) > 0 && ['ready', 'streaming', 'reattach_wait'].includes(String(value.status)) })
  }
  const observeAttachment = (value: unknown, currentRevision: number) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !knownSession(value.session_id, value.connection_generation, false)) return
    const previous = attachments.get(value.id)
    if (previous?.detached || (previous?.revision ?? 0) > currentRevision) return
    attachments.set(value.id, { session: String(value.session_id), generation: Number(value.connection_generation),
      usable: !['failed', 'invalidated', 'detached'].includes(String(value.state)), revision: currentRevision })
  }
  return mcp.tools.map((tool) => {
    const name = mcp.originalName(tool.name) ?? ''
    if (!name.startsWith('termous.desktops.') && !name.startsWith('termous.desktop_workflows.')) return tool
    const validate = (args: unknown) => {
      if (!isRecord(args)) return
      if (workflow && name === 'termous.desktop_workflows.runs.start'
        && (args.script_id !== workflow.workflow_id || args.version !== workflow.workflow_version)) {
        reject({ script_id: workflow.workflow_id, version: workflow.workflow_version })
      }
      if (!desktop) return
      if (name === 'termous.desktops.connect') {
        if (desktop.kind !== 'desktop_profile' || args.profile_id !== desktop.desktop_profile_id || args.host_id !== undefined) reject(expectedTarget)
      }
      if (name === 'termous.desktops.get' && args.session_id !== undefined
        && desktop.kind === 'desktop_session' && args.session_id !== desktop.session_id) reject(expectedTarget)
      if ((name === 'termous.desktops.attach' || name === 'termous.desktops.close')
        && !knownSession(args.session_id, args.connection_generation, name !== 'termous.desktops.close')) reject(expectedTarget)
      if ('attachment_id' in args) {
        // 失效目标仍允许查询和释放本轮已有入口，清理由 Core 复验归属与控制代次。
        const ownedOnly = name === 'termous.desktops.get' || name === 'termous.desktops.detach'
          || name === 'termous.desktops.control.release' || name === 'termous.desktops.operations.get'
        const owned = typeof args.attachment_id === 'string' ? attachments.get(args.attachment_id) : undefined
        const allowed = ownedOnly ? owned !== undefined && !owned.detached : knownAttachment(args.attachment_id)
        if (!allowed) reject({ attachment_id: [...attachments.keys()] })
      }
      if (name === 'termous.desktop_workflows.runs.start') {
        if (desktop.kind === 'desktop_session') {
          if (args.profile_id !== undefined || args.session_id !== desktop.session_id || args.connection_generation !== desktop.connection_generation) reject(expectedTarget)
        } else if (args.profile_id !== undefined) {
          if (args.session_id !== undefined || args.profile_id !== desktop.desktop_profile_id) reject(expectedTarget)
        } else if (!knownSession(args.session_id, args.connection_generation)) reject(expectedTarget)
      }
    }
    const parameters = name === 'termous.desktop_workflows.runs.start'
      ? restrictFields(tool.parameters, {
          ...(workflow ? { script_id: workflow.workflow_id, version: workflow.workflow_version } : {}),
          ...(desktop?.kind === 'desktop_session' ? expectedTarget : {}),
        }) : tool.parameters
    return {
      ...tool, parameters,
      prepareArguments: (args) => {
        const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args
        validate(prepared)
        return prepared
      },
      execute: async (id, args, signal, update) => {
        validate(args)
        const currentRevision = ++revision
        // 保留已核验身份供失败或准备中的连接清理，但输入必须重新取得可用回执。
        if (isRecord(args)) {
          if (typeof args.session_id === 'string' && (name === 'termous.desktops.get' || name === 'termous.desktops.close')) {
            sessions.set(args.session_id, { ...sessions.get(args.session_id), ready: false, revision: currentRevision })
          }
          const attachment = typeof args.attachment_id === 'string' ? attachments.get(args.attachment_id) : undefined
          if (attachment && (name === 'termous.desktops.get' || name === 'termous.desktops.detach')) {
            attachments.set(String(args.attachment_id), { ...attachment, usable: false, revision: currentRevision })
          }
        }
        const result = await tool.execute(id, args, signal, update)
        if (!isMCPToolDetails(result.details) || result.details.result.isError) return result
        const output = result.details.result.structuredContent
        if (!isRecord(output) || output.error) return result
        if (name === 'termous.desktops.connect'
          || name === 'termous.desktops.get' && isRecord(args) && isRecord(output.session) && output.session.id === args.session_id) observeSession(output.session, currentRevision)
        if (isRecord(args)) {
          const attachment = isRecord(output.control) ? output.control.attachment : output.attachment
          if (isRecord(attachment) && (name === 'termous.desktops.attach'
            ? attachment.session_id === args.session_id && attachment.connection_generation === args.connection_generation
            : attachment.id === args.attachment_id)) observeAttachment(attachment, currentRevision)
        }
        if (isRecord(args) && output.completed) {
          const attachment = attachments.get(String(args.attachment_id))
          if (name === 'termous.desktops.detach' && attachment) {
            attachments.set(String(args.attachment_id), { ...attachment, usable: false, detached: true, revision: currentRevision })
          }
          // 留下回执序号，阻止更早的查询在关闭成功后复活路由。
          if (name === 'termous.desktops.close') sessions.set(String(args.session_id), { ready: false, revision: ++revision })
        }
        return result
      },
    }
  })
}

function restrictFields(schema: AgentTool['parameters'], values: Record<string, unknown>): AgentTool['parameters'] {
  const raw: unknown = schema
  if (!isRecord(raw) || !isRecord(raw.properties)) return schema
  const properties = { ...raw.properties }
  for (const [key, value] of Object.entries(values)) if (isRecord(properties[key])) properties[key] = { allOf: [properties[key], { const: value }] }
  return { ...schema, properties }
}
