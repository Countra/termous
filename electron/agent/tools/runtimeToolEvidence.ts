import { createHash } from 'node:crypto'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { isRecord } from '../contracts/validation.ts'
import { runtimeCapability, runtimeCapabilityStep } from './runtimeCapabilityCatalog.ts'
import { runtimeToolFailureCode, runtimeToolOutcome } from './runtimeToolOutcome.ts'

export const progressMetaTools = new Set(['read_skill_resource', 'discover_tools', 'read_history_image'])

export function progressDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => isRecord(item)
    ? Object.fromEntries(Object.keys(item).sort().filter((key) => key !== 'client_request_id' && key !== 'refresh').map((key) => [key, item[key]]))
    : item) ?? 'null').digest('hex')
}

export function progressData(result: AgentToolResult<unknown>): Record<string, unknown> {
  if (isMCPToolDetails(result.details) && isRecord(result.details.result.structuredContent)) return result.details.result.structuredContent
  // 历史只持久化内容块，恢复时仅读取结构，不将普通输出作为执行指令。
  for (const part of result.content) {
    if (part.type !== 'text') continue
    const start = part.text.indexOf('{')
    if (start < 0) continue
    try {
      const value: unknown = JSON.parse(part.text.slice(start))
      if (isRecord(value)) return typeof value.screenshot_id === 'string' ? { capture: value } : value
    } catch { /* 非结构化输出不恢复资源身份。 */ }
  }
  return {}
}

export function progressResource(args: unknown, data?: Record<string, unknown>): string {
  const attachment = data?.attachment
  if (isRecord(attachment) && typeof attachment.session_id === 'string' && Number.isSafeInteger(attachment.connection_generation)) {
    return `session_id:${attachment.session_id}:generation:${attachment.connection_generation}`.slice(0, 256)
  }
  if (!isRecord(args)) return 'unresolved'
  const identity = ['attachment_id', 'run_id', 'task_id', 'operation_id', 'transfer_id', 'forward_id', 'snapshot_id', 'preview_id', 'session_id', 'file_session_id', 'source_file_session_id', 'script_id', 'profile_id', 'ssh_profile_id', 'file_access_profile_id', 'host_id', 'uri', 'id']
    .find((key) => typeof args[key] === 'string')
  if (identity) {
    const target = Object.fromEntries(['path', 'remote_path', 'unit_id', 'pid', 'container_id', 'resource_id', 'job_id', 'snippet_id', 'group_id', 'target_file_session_id'].filter((key) => args[key] !== undefined).map((key) => [key, args[key]]))
    for (const key of ['connection_generation', 'expected_connection_generation', 'expected_source_connection_generation', 'expected_target_connection_generation']) {
      if (Number.isSafeInteger(args[key])) target[key] = args[key]
    }
    const scope = Object.keys(target).length ? `:target:${progressDigest(target).slice(0, 24)}` : ''
    return `${identity}:${String(args[identity]).slice(0, 160)}${scope}`
  }
  if (Array.isArray(args.session_ids)) return `sessions:${progressDigest(args.session_ids)}`
  return 'unresolved'
}

export function progressFailure(data: Record<string, unknown>, name: string) {
  const code = runtimeToolFailureCode(name, data)
  return code ? { code } : undefined
}

export function progressArguments(args: unknown) {
  if (!isRecord(args)) return args
  return { ...args, wait_ms: undefined, after_revision: undefined, after_sequence: undefined, client_request_id: undefined, refresh: undefined }
}

export function progressPolling(name: string, _args: unknown, data: Record<string, unknown>) {
  const role = runtimeCapabilityStep(name)?.role
  const outcome = runtimeToolOutcome(name, data)
  if (outcome === 'waiting') return true
  return outcome === 'pending' && (role === 'poll' || role === 'inspect')
}

export function progressFingerprint(name: string, data: Record<string, unknown>, result: AgentToolResult<unknown>) {
  if (runtimeCapabilityStep(name)?.evidence === 'image') {
    const capture = isRecord(data.capture) ? data.capture : isRecord(data.snapshot) ? data.snapshot : isRecord(data.view) ? data.view : data
    const metadata = isRecord(capture.metadata) ? capture.metadata : isRecord(capture.source) ? capture.source : {}
    const view = isRecord(capture.image_view) ? capture.image_view : {}
    return progressDigest({
      images: result.content.filter((part) => part.type === 'image').map((part) => progressDigest(part.data)),
      connection_generation: metadata.connection_generation, execution_generation: metadata.execution_generation,
      display_epoch: metadata.display_epoch, region: metadata.region,
      image_view: { width: view.width, height: view.height, source_region: view.source_region },
    })
  }
  if (progressMetaTools.has(name)) return progressDigest(name === 'read_skill_resource' && isRecord(result.details) ? result.details.sha256 ?? result.content : result.content)
  const effective = structuredClone(data)
  for (const path of runtimeCapability(name)?.evidence?.volatile ?? []) {
    const parts = path.split('.')
    const key = parts.pop()!
    const parent = parts.reduce<unknown>((value, part) => isRecord(value) ? value[part] : undefined, effective)
    if (isRecord(parent)) delete parent[key]
  }
  return progressDigest(Object.keys(data).length ? effective : result.content)
}

export function progressFact(name: string, resource: string, data: Record<string, unknown>, error: boolean, code?: string) {
  const values: Record<string, string | number | boolean> = {}
  const fields = ['id', 'session_id', 'file_session_id', 'task_id', 'operation_id', 'transfer_id', 'forward_id', 'connection_generation', 'execution_generation', 'state', 'status', 'phase', 'revision', 'exit_code', 'next_offset', 'eof', 'partial', 'uncertain', 'snapshot_id', 'preview_id', 'asset_id', 'script_id', 'version', 'completed', 'closed']
  const capture = isRecord(data.capture) ? data.capture : isRecord(data.snapshot) ? data.snapshot : {}
  for (const branch of [data, ...['session', 'attachment', 'snapshot', 'preview', 'script', 'run', 'operation', 'task', 'transfer', 'instance', 'mutation', 'crontab'].map((key) => data[key]), capture.metadata, capture.source, isRecord(data.report) ? data.report.run : undefined]) {
    if (!isRecord(branch)) continue
    for (const field of fields) {
      const value = branch[field]
      if (typeof value === 'string' && value.length <= 128 || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') values[field] = value as string | number | boolean
    }
  }
  return { tool: name, resource, outcome: error ? `error:${code ?? 'tool_failed'}` : runtimeCapabilityStep(name)?.role === 'input' || values.state === 'accepted' ? '协议已接收，尚需观察应用结果' : '已取得回执', values }
}
