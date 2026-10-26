import { hostDesktopTargetKey, isHostDesktopTarget } from '#common/contracts'
import { fail, rows, type Arguments, type PreparationContext } from './contracts.ts'

export function hasHostDesktopTarget(ctx: PreparationContext, args: Arguments): boolean {
  return args.target !== undefined || ctx.bindings.some(binding => binding.kind === 'host_desktop')
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
  if (!source) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The selected host source is no longer available. Select it again; do not switch displays automatically.', 'user_action')
  return source.target as Arguments
}
