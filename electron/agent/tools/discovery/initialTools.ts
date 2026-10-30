import type { ObservationTarget } from '../../contracts/desktopObservation.ts'
import type { RuntimeResourceBinding } from '../../contracts/resourceBindings.ts'
import { capabilityToolName } from '../runtimeCapabilityCatalog.ts'
import type { ToolCapability } from '../../contracts/toolCapabilities.ts'
import { mergeEntryQueues } from './entries.ts'

interface InitialToolEntry { original: string; trusted: boolean; capability?: ToolCapability }

// 历史目标仅选择声明入口，不恢复连接、附着或输入授权。
export function initialTools(entries: readonly InitialToolEntry[], bindings: readonly RuntimeResourceBinding[],
  available: (name: string) => boolean, target?: ObservationTarget): string[] {
  const kinds = new Set<string>(bindings.map(binding => binding.kind))
  if (entries.some(entry => entry.trusted && entry.original.startsWith('termous.local.'))) kinds.add('local')
  if (target) kinds.add(target.kind === 'host_desktop' ? 'host_desktop' : 'desktop_session')
  const priority = (entry: InitialToolEntry, kind: string) => entry.capability?.discovery.preload?.find(rule =>
    rule.bindings.includes(kind) && capabilityToolName(entry.capability!, rule.tool) === entry.original)?.priority
  const queue = (kind: string) => entries
    .filter(entry => entry.trusted && available(entry.original) && priority(entry, kind) !== undefined)
    .sort((a, b) => priority(a, kind)! - priority(b, kind)! || a.original.localeCompare(b.original)).map(entry => entry.original)
  const names = mergeEntryQueues([...kinds].sort().map(queue), 8)
  // 默认入口仅补剩余名额；是否提供由合同声明，不针对任务文本或某类工具增加分支。
  return [...new Set([...names, ...queue('default')])].slice(0, 8)
}
