import type { HostReachability, HostReachabilityEvent } from '#entities/host'

export type SSHProfileReachabilityIndex = Readonly<Record<string, HostReachability>>

export function indexSSHProfileReachability(states: HostReachability[]) {
  return states.reduce<Record<string, HostReachability>>((current, state) => {
    if (state.ssh_profile_id) {
      current[state.ssh_profile_id] = state
    }
    return current
  }, {})
}

export function mergeSSHProfileReachabilityEvent(
  current: SSHProfileReachabilityIndex,
  event: HostReachabilityEvent,
): SSHProfileReachabilityIndex {
  if (event.type === 'snapshot' && event.items) {
    return indexSSHProfileReachability(event.items)
  }
  if (event.state?.ssh_profile_id) {
    return { ...current, [event.state.ssh_profile_id]: event.state }
  }
  return current
}

export function decodeSSHProfileReachabilityEvent(data: string): HostReachabilityEvent | null {
  try {
    const event = JSON.parse(data) as HostReachabilityEvent
    if (!event || typeof event.type !== 'string') {
      return null
    }
    if (event.type === 'snapshot') {
      return Array.isArray(event.items) ? event : null
    }
    return event.state?.ssh_profile_id ? event : null
  } catch {
    return null
  }
}
