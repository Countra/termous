export interface HostDesktopSource { target: HostDesktopTarget; name: string; read_only: boolean }

export interface HostDesktopTarget {
  kind: 'host_desktop'
  instance_id: string
  host: { id: string; kind: 'screen' | 'window'; title: string; generation: number }
}

export function isHostDesktopTarget(value: unknown): value is HostDesktopTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as Record<string, unknown>
  const host = target.host as Record<string, unknown> | undefined
  const protocol = target.protocol as Record<string, unknown> | undefined
  return target.kind === 'host_desktop' && typeof target.instance_id === 'string' && target.instance_id.length > 0
    && Boolean(host && typeof host.id === 'string' && host.id.length > 0 && typeof host.title === 'string'
      && (host.kind === 'screen' || host.kind === 'window') && Number.isSafeInteger(host.generation) && Number(host.generation) > 0)
    && (!protocol || Object.values(protocol).every(value => value === '' || value === 0))
}

export const hostDesktopTargetKey = (target: HostDesktopTarget) =>
  JSON.stringify([target.instance_id, target.host.kind, target.host.id, target.host.generation])
