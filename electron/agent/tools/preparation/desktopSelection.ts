import { observationTarget, observationTargetKey } from '../../contracts/desktopObservation.ts'
import type { Arguments, PreparationContext } from './contracts.ts'

export function desktopSelection(ctx: PreparationContext, args: Arguments): Arguments {
  if (['target', 'session_id', 'profile_id', 'host_id'].some(field => args[field] !== undefined)
    || ctx.bindings.some(value => ['host_desktop', 'desktop_session', 'desktop_profile'].includes(value.kind))) return args
  const target = ctx.desktop?.current()
  return target?.kind === 'host_desktop' ? { ...args, target }
    : target ? { ...args, session_id: target.session_id, connection_generation: target.connection_generation } : args
}

export function attachmentMatches(ctx: PreparationContext, args: Arguments, attachment: Arguments) {
  const selection = desktopSelection(ctx, args)
  const binding = ctx.bindings.find(value => ['host_desktop', 'desktop_session', 'desktop_profile'].includes(value.kind))
  const target = observationTarget(selection.target ?? (binding?.kind === 'host_desktop' ? binding.desktop_target : undefined))
  if (target) {
    const actual = observationTarget(attachment.target) ?? observationTarget(attachment)
    return actual !== undefined && observationTargetKey(actual) === observationTargetKey(target)
  }
  const session = selection.session_id ?? (binding?.kind === 'desktop_session' ? binding.session_id : undefined)
  const generation = selection.connection_generation ?? (binding?.kind === 'desktop_session' ? binding.connection_generation : undefined)
  if (session !== undefined) return attachment.session_id === session && (generation === undefined || attachment.connection_generation === generation)
  const profile = selection.profile_id ?? (binding?.kind === 'desktop_profile' ? binding.desktop_profile_id : undefined)
  if (profile === undefined) return true
  // 附着合同不包含 Profile；只能通过本轮已核验的同代会话确认归属。
  const verified = ctx.read(`desktop:session:${String(attachment.session_id)}`)
  return verified?.id === attachment.session_id && verified?.connection_generation === attachment.connection_generation
    && verified?.profile_id === profile
}
