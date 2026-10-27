import { isRecord } from '../../contracts/validation.ts'
import { fail, type Arguments, type PreparationContext } from './contracts.ts'

export function checkDesktopPointer(ctx: PreparationContext, args: Arguments, attachment: Arguments) {
  let capability: string | undefined
  if (ctx.name === 'termous.desktops.pointer.position') capability = 'pointer_position'
  else if (ctx.name === 'termous.desktops.pointer.click_current') capability = 'pointer_click_current'
  else if (ctx.name === 'termous.desktops.pointer.move' && args.duration_ms !== undefined) {
    if (typeof args.duration_ms !== 'number' || !Number.isInteger(args.duration_ms) || args.duration_ms < 0 || args.duration_ms > 2000) fail('AGENT_ARGUMENT_INVALID', 'duration_ms must be an integer from 0 to 2000. Omit it or use 0 for the existing immediate move.')
    if (args.duration_ms > 0) capability = 'pointer_smooth'
  }
  if (capability && (!isRecord(attachment.capabilities) || attachment.capabilities[capability] !== true)) {
    fail('AGENT_DESKTOP_CAPABILITY_UNSUPPORTED', `The current target does not advertise ${capability}. Use termous.desktops.capture({}) to observe, then termous.desktops.pointer.move with duration_ms=0 or termous.desktops.pointer.click with explicit coordinates. Do not substitute a remembered pointer position or request control repeatedly.`, {
      kind: 'reread', tool: 'termous.desktops.capture', arguments: {},
    })
  }
}
