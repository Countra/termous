import { hostDesktopTargetKey, isHostDesktopTarget } from '#common/contracts'
import { fail, rows, type Arguments, type PreparationContext } from './contracts.ts'
import { isRecord } from '../../contracts/validation.ts'
import { observationTarget } from '../../contracts/desktopObservation.ts'

export function hasHostDesktopTarget(ctx: PreparationContext, args: Arguments): boolean {
  return isRecord(args.target) && args.target.kind === 'host_desktop' || ctx.bindings.some(binding => binding.kind === 'host_desktop')
}

// 每次准备只复验精确来源，禁止按标题或显示器顺序重新绑定。
export async function hostDesktopTarget(ctx: PreparationContext, args: Arguments): Promise<Arguments> {
  const binding = ctx.bindings.find(value => value.kind === 'host_desktop')
  const target = args.target ?? binding?.desktop_target
  if (!isHostDesktopTarget(target) || args.session_id !== undefined || args.profile_id !== undefined || args.connection_generation !== undefined
    || binding && hostDesktopTargetKey(target) !== hostDesktopTargetKey(binding.desktop_target)) {
    fail('AGENT_RESOURCE_BINDING_MISMATCH', 'Choose the exact current host desktop target without a protocol session.', 'user_action')
  }
  const discovered = await ctx.invoke('termous.desktops.sources', { kind: target.host.kind }, 'host_sources')
  const source = rows(discovered.sources).find(value => isHostDesktopTarget(value.target)
    && hostDesktopTargetKey(value.target) === hostDesktopTargetKey(target))
  if (!source) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The selected host source is no longer available. Use termous.desktops.sources to inspect available sources and ask the user to select again; do not switch displays automatically.', {
    kind: 'user_action', tool: 'termous.desktops.sources', arguments: { kind: target.host.kind },
  })
  // 标题不属于目标身份；首次派发与准备记录重放使用同一规范参数，避免幂等摘要发生变化。
  return { ...observationTarget(source.target)! }
}
