import { isRecord } from '../../contracts/validation.ts'
import type { RuntimeResourceBinding } from '../../contracts/resourceBindings.ts'
import type { ToolNavigation } from './contracts.ts'

export function desktopObservationNavigation(name: string, data: Record<string, unknown>, bindings: RuntimeResourceBinding[]): ToolNavigation | undefined {
  if (!['termous.desktops.get', 'termous.desktops.capture'].includes(name)) return undefined
  const error = isRecord(data.error) ? data.error : undefined
  const attachment = isRecord(data.attachment) ? data.attachment : undefined
  if (error?.code !== 'desktop_generation_stale' && !['invalidated', 'detached'].includes(String(attachment?.state))) return undefined
  const host = bindings.find(value => value.kind === 'host_desktop')
  const session = bindings.find(value => value.kind === 'desktop_session')
  const query = host?.kind === 'host_desktop' ? { tool: 'termous.desktops.sources', arguments: { kind: host.desktop_target.host.kind } }
    : session?.kind === 'desktop_session' ? { tool: 'termous.desktops.get', arguments: { session_id: session.session_id } } : undefined
  return { names: query ? [query.tool, 'termous.desktops.attach'] : ['termous.desktops.sources', 'termous.desktops.list', 'termous.desktops.attach'],
    recovery: true, observationOnly: true, ...(query ? { prerequisite: query } : {}),
    guidance: `${typeof error?.message === 'string' ? error.message : 'The observation attachment is no longer usable.'} `
      + 'get only reads an existing object; repeatedly querying the expired attachment will not restore it. '
      + (query ? `Use ${query.tool} with ${JSON.stringify(query.arguments)} to verify the original target, then termous.desktops.attach.`
        : 'Use termous.desktops.sources for a host source or termous.desktops.list for a protocol session; then use termous.desktops.attach with the verified target.')
      + ' Do not replace a bound target or replay uncertain input.',
  }
}
