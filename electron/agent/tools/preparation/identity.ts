import { createHash } from 'node:crypto'
import type { Arguments } from './contracts.ts'
import { isRecord } from '../../contracts/validation.ts'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}
export function argumentDigest(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }
export function requestIdentity(runID: string, generation: number, callID: string, step: string) {
  return `agt_${argumentDigest([runID, generation, callID, step]).slice(0, 48)}`
}

// 只保存路由和并发校验字段，命令、路径、正文及图片不进入准备记录。
const saved = new Set(['client_request_id', 'attachment_id', 'grant_id', 'session_id', 'session_ids', 'profile_id', 'ssh_profile_id', 'file_access_profile_id', 'file_session_id', 'source_file_session_id', 'target_file_session_id', 'connection_generation', 'expected_connection_generation', 'source_connection_generation', 'target_connection_generation', 'script_id', 'version', 'expected_revision', 'expected_plan_hash', 'base_sha256', 'base_size', 'base_modified_at', 'line_ending', 'has_bom', 'source'])
saved.add('expected_updated_at')
export function preparedValues(args: Arguments) {
  const values = Object.fromEntries(Object.entries(args).filter(([key, value]) => saved.has(key) && value !== undefined && value !== null))
  if (Array.isArray(args.items) && args.items.every((v) => isRecord(v) && typeof v.id === 'string' && typeof v.expected_updated_at === 'string')) values.items = args.items.map((v) => ({ id: v.id, expected_updated_at: v.expected_updated_at }))
  return values
}

export function restorePreparedValues(args: Arguments, values: Arguments) {
  const { items, ...fields } = values
  Object.assign(args, fields)
  if (Array.isArray(items) && Array.isArray(args.items)) args.items = args.items.map((v) => isRecord(v) ? { ...v, expected_updated_at: items.find((saved) => isRecord(saved) && saved.id === v.id)?.expected_updated_at } : v)
  return args
}

export class PreparationSnapshots {
  private readonly entries = new Map<string, Arguments>()
  read(key: string) { return this.entries.get(key) }
  forget(key: string) { this.entries.delete(key) }
  remember(key: string, value: Arguments) {
    this.entries.delete(key)
    this.entries.set(key, value)
    // 元数据窗口只保留近期读取；被淘汰的版本要求重新读取，不默默采用最新版本覆盖。
    while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!)
  }
}
