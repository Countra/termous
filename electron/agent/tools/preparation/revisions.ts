import { isRecord } from '../../contracts/validation.ts'
import { argumentDigest } from './identity.ts'
import { defaultValue, fail, type Arguments, type PreparationContext } from './contracts.ts'
import { previewRecovery, revisionRecovery } from '../recovery/revisions.ts'

function planKey(name: string, args: Arguments) {
  const selector = Object.fromEntries(Object.entries(args).filter(([key]) => !['client_request_id', 'expected_plan_hash', 'offset', 'limit'].includes(key)))
  return `plan:${name.replace(/\.(preview|start)$/u, '')}:${argumentDigest(selector)}`
}
function textKey(args: Arguments) { return `file:${argumentDigest([args.file_session_id, args.expected_connection_generation, args.path])}` }
function revisionKey(ctx: PreparationContext, args: Arguments) {
  if (ctx.name.startsWith('termous.desktop_workflows.')) return `workflow:${args.script_id}`
  if (ctx.name.startsWith('termous.snippets.')) return `${ctx.name.includes('.groups.') ? 'group' : 'snippet'}:${args.snippet_id ?? args.group_id}`
  if (ctx.name.startsWith('termous.remoteops.crontab.')) return `crontab:${args.session_id}`
  return undefined
}

export function prepareRevisions(ctx: PreparationContext, args: Arguments) {
  // 导入提交的 create/update 为显式业务选择，不能借通用修订缓存补入目标或版本。
  if (ctx.name === 'termous.desktop_workflows.imports.commit') return
  const groups = ctx.read('groups:revisions')
  if (ctx.name === 'termous.snippets.groups.reorder' && Array.isArray(args.items)) {
    args.items = args.items.map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string') fail('AGENT_PARAMETER_INVALID', 'Each group needs its explicit id and sort_order.')
      const revision = item.expected_updated_at ?? ctx.read(`group:${item.id}`)?.expected_updated_at ?? groups?.[item.id]
      if (revision === undefined) fail('AGENT_READ_REQUIRED', 'Read the complete group list with termous.snippets.groups.list before changing its order.', { kind: 'reread', tool: 'termous.snippets.groups.list', arguments: {} })
      return { ...item, expected_updated_at: revision }
    })
  }
  const key = revisionKey(ctx, args)
  const snapshot = key ? ctx.read(key) : undefined
  for (const field of ['expected_revision', 'expected_updated_at']) {
    if (!ctx.has(field) || args[field] !== undefined) continue
    const value = snapshot?.[field] ?? (field === 'expected_updated_at' && ctx.name.startsWith('termous.snippets.groups.') ? groups?.[String(args.group_id)] : undefined)
    if (value === undefined) fail('AGENT_READ_REQUIRED', 'Read this resource before editing it. A missing revision cannot be replaced with a new latest version.', revisionRecovery(ctx.name, args))
    args[field] = value
  }
  if (ctx.has('expected_plan_hash') && args.expected_plan_hash === undefined) {
    const snapshot = ctx.read(planKey(ctx.name, args))
    if (!snapshot) fail('AGENT_PREVIEW_REQUIRED', 'Preview these exact operation parameters before executing the plan.', previewRecovery(ctx.name, args))
    args.expected_plan_hash = snapshot.plan_hash
  }
  if (ctx.name === 'termous.files.save_text') {
    const snapshot = ctx.read(textKey(args))
    for (const field of ['base_sha256', 'base_size', 'base_modified_at', 'line_ending', 'has_bom']) defaultValue(args, field, snapshot?.[field])
    if (args.base_sha256 === undefined) fail('AGENT_READ_REQUIRED', 'Use termous.files.read_text to read the original file before saving changes.', {
      kind: 'reread', tool: 'termous.files.read_text', arguments: { file_session_id: args.file_session_id, path: args.path },
    })
  }
}

export function observeRevisions(ctx: PreparationContext, args: Arguments, output: Arguments) {
  if (ctx.name.endsWith('.preview') && isRecord(output.preview) && typeof output.preview.plan_hash === 'string') {
    ctx.remember(planKey(ctx.name, args), { plan_hash: output.preview.plan_hash })
  }
  if (ctx.name === 'termous.files.read_text' && isRecord(output.file)) {
    const file = output.file
    if (file.file_session_id === args.file_session_id && file.path === args.path) ctx.remember(textKey(args), {
      base_sha256: file.sha256, base_size: file.size, base_modified_at: file.modified_at, line_ending: file.line_ending, has_bom: file.has_bom,
    })
  }
  if (ctx.name.startsWith('termous.snippets.')) {
    if (ctx.name === 'termous.snippets.groups.list' && isRecord(output.groups) && Array.isArray(output.groups.items)) ctx.remember('groups:revisions', Object.fromEntries(output.groups.items.filter((v) => isRecord(v) && typeof v.id === 'string' && typeof v.updated_at === 'string').slice(0, 200).map((v) => [v.id, v.updated_at])))
    for (const field of ['snippet', 'group']) {
      const value = output[field]
      if (isRecord(value) && typeof value.id === 'string') ctx.remember(`${field}:${value.id}`, { expected_updated_at: value.updated_at })
    }
  }
  if (ctx.name.startsWith('termous.remoteops.crontab.') && isRecord(output.crontab)) {
    ctx.remember(`crontab:${args.session_id}`, { expected_revision: output.crontab.revision })
  }
}
