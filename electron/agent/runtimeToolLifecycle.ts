import { isRecord } from './protocol.ts'

// 资源依赖按具体操作声明，观察或编辑不会提前暴露无关的关闭、释放入口。
const dependencies: Array<[RegExp, string[]]> = [
  [/^termous\.desktop_workflows\.captures\.(create|view)$/u, ['termous.desktop_workflows.captures.release']],
  [/^termous\.desktop_workflows\.templates\.preview$/u, ['termous.desktop_workflows.templates.discard']],
  [/^termous\.desktop_workflows\.runs\.(start|control)$/u, ['termous.desktop_workflows.runs.get', 'termous.desktop_workflows.runs.control', 'wait_workflow_run']],
  [/^termous\.desktops\.(?:control\.acquire|pointer\..*|keyboard\..*|clipboard\..*|resize)$/u, ['termous.desktops.control.release', 'termous.desktops.operations.get']],
  [/^termous\.desktops\.attach$/u, ['termous.desktops.detach']],
  [/^termous\.desktops\.connect$/u, ['termous.desktops.close']],
  [/^termous\.sessions\.connect$/u, ['termous.sessions.close']],
  [/^termous\.commands\.dispatch$/u, ['termous.commands.get', 'termous.commands.interrupt']],
  [/^termous\.files\.sessions\.(connect|reconnect)$/u, ['termous.files.sessions.close']],
  [/^termous\.files\.transfers\.(upload|download|remote_copy)$/u, ['termous.files.transfers.cancel']],
  [/^termous\.files\.batch_rename\.start$/u, ['termous.files.batch_rename.cancel']],
  [/^termous\.files\.delete\.start$/u, ['termous.files.delete.cancel']],
  [/^termous\.forwarding\.instances\.start$/u, ['termous.forwarding.instances.stop']],
]

export function runtimeToolDependencies(name: string): string[] {
  return dependencies.flatMap(([pattern, names]) => pattern.test(name) ? names : [])
}

interface Completion { fields: string[]; flag: string; next: string }
// 只登记协议明确确认的不可逆资源终态。取消意图、暂停、按键和普通幂等写入不等同于资源结束。
const completions: Record<string, Completion> = {
  'termous.desktop_workflows.captures.release': { fields: ['snapshot_id'], flag: 'completed', next: 'termous.desktop_workflows.captures.create' },
  'termous.desktop_workflows.templates.discard': { fields: ['preview_id'], flag: 'completed', next: 'termous.desktop_workflows.templates.preview' },
  'termous.desktops.control.release': { fields: ['attachment_id', 'grant_id'], flag: 'completed', next: 'termous.desktops.control.acquire' },
  'termous.desktops.detach': { fields: ['attachment_id'], flag: 'completed', next: 'termous.desktops.attach' },
  'termous.desktops.close': { fields: ['session_id', 'connection_generation'], flag: 'completed', next: 'termous.desktops.connect' },
  'termous.sessions.close': { fields: ['session_id'], flag: 'closed', next: 'termous.sessions.connect' },
}

export function completedToolResource(name: string, args: unknown, data?: Record<string, unknown>) {
  const rule = completions[name]
  if (!rule || !isRecord(args) || data && data[rule.flag] !== true) return undefined
  if (rule.fields.some((field) => typeof args[field] !== 'string' && typeof args[field] !== 'number' || args[field] === '')) return undefined
  return rule.fields.map((field) => args[field])
}

export function completedToolGuidance(name: string) {
  const next = completions[name]?.next
  return `该资源的释放或关闭已确认完成，重复调用不会创建资源，也不会推进任务。需要新的资源时先用 discover_tools 查找准确操作${next ? ` ${next}` : ''}；清理其他资源必须使用其真实标识。已完成资源不会再次派发清理。`
}

export function resourceToolNavigation(name: string, data: unknown) {
  if (!isRecord(data)) return undefined
  if (name === 'termous.desktop_workflows.captures.release' && data.completed === true) return {
    names: ['termous.desktop_workflows.captures.create'],
    guidance: '旧快照已释放；创建新快照使用 captures.create，不能重复 release。新快照必须使用本轮有效 attachment_id，不能复用已释放的 snapshot_id。',
  }
  if (name === 'termous.desktop_workflows.captures.create' && isRecord(data.snapshot)) return {
    names: ['termous.desktop_workflows.captures.view', 'termous.desktop_workflows.templates.preview'],
    guidance: '使用本次 snapshot_id 和 image_view 展示像素；需要局部查看用 captures.view，制作模板用 templates.preview，释放仅用于清理。',
  }
  return undefined
}
