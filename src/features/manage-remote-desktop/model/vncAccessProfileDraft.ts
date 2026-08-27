import {
  isRemoteDesktopLoopbackAddress,
  isValidRemoteDesktopIPAddress,
  normalizeRemoteDesktopIPAddress,
  type RemoteDesktopAccessProfile,
  type RemoteDesktopAccessProfileInput,
  type RemoteDesktopRoute,
  type VncProfileSettings,
} from '#entities/remote-desktop'

export interface VNCAccessProfileDraft {
  name: string
  description: string
  route: RemoteDesktopRoute
  ssh_profile_id: string
  vnc: Omit<VncProfileSettings, 'port'> & { port: number | null }
  route_memory?: {
    ssh_profile_id: string
    direct_target_host: string
  }
}

export interface VNCAccessProfileDraftErrors {
  name?: 'required' | 'too_long'
  ssh_profile_id?: 'required' | 'missing'
  target_host?: 'required' | 'invalid' | 'loopback'
  port?: 'range'
}

export function createVNCAccessProfileDraft(defaultSSHProfileId = ''): VNCAccessProfileDraft {
  const useSSHTunnel = Boolean(defaultSSHProfileId)
  return {
    name: '',
    description: '',
    route: useSSHTunnel ? 'ssh_tunnel' : 'direct',
    ssh_profile_id: useSSHTunnel ? defaultSSHProfileId : '',
    vnc: {
      target_host: useSSHTunnel ? '127.0.0.1' : '',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
  }
}

export function vncAccessProfileToDraft(
  profile: RemoteDesktopAccessProfile,
): VNCAccessProfileDraft {
  return {
    name: profile.name,
    description: profile.description,
    route: profile.route,
    ssh_profile_id: profile.route === 'ssh_tunnel' ? profile.ssh_profile_id : '',
    vnc: { ...profile.vnc },
  }
}

export function normalizeVNCAccessProfileDraft(
  hostId: string,
  draft: VNCAccessProfileDraft,
): RemoteDesktopAccessProfileInput {
  const normalized = normalizeDraftValues(draft)
  const common = {
    host_id: hostId,
    name: normalized.name,
    description: normalized.description,
    protocol: 'vnc' as const,
    protocol_config_version: 1 as const,
    vnc: {
      ...normalized.vnc,
      port: normalized.vnc.port ?? 0,
    },
  }
  return normalized.route === 'ssh_tunnel'
    ? {
        ...common,
        route: 'ssh_tunnel',
        route_config_version: 1,
        ssh_profile_id: normalized.ssh_profile_id,
      }
    : {
        ...common,
        route: 'direct',
        route_config_version: 1,
      }
}

export function validateVNCAccessProfileDraft(
  draft: VNCAccessProfileDraft,
  availableSSHProfileIds: ReadonlySet<string>,
): VNCAccessProfileDraftErrors {
  const errors: VNCAccessProfileDraftErrors = {}
  const name = draft.name.trim()
  if (!name) {
    errors.name = 'required'
  } else if (Array.from(name).length > 80) {
    errors.name = 'too_long'
  }
  if (draft.route === 'ssh_tunnel') {
    if (!draft.ssh_profile_id.trim()) {
      errors.ssh_profile_id = 'required'
    } else if (!availableSSHProfileIds.has(draft.ssh_profile_id)) {
      errors.ssh_profile_id = 'missing'
    }
    if (!isRemoteDesktopLoopbackAddress(draft.vnc.target_host.trim())) {
      errors.target_host = 'loopback'
    }
  } else {
    const targetHost = draft.vnc.target_host.trim()
    if (!targetHost) {
      errors.target_host = 'required'
    } else if (!isValidRemoteDesktopIPAddress(targetHost)) {
      errors.target_host = 'invalid'
    }
  }
  if (!Number.isSafeInteger(draft.vnc.port) || (draft.vnc.port ?? 0) < 1 || (draft.vnc.port ?? 0) > 65535) {
    errors.port = 'range'
  }
  return errors
}

export function vncAccessProfileDraftsEqual(
  left: VNCAccessProfileDraft,
  right: VNCAccessProfileDraft,
) {
  return JSON.stringify(normalizeDraftValues(left)) === JSON.stringify(normalizeDraftValues(right))
}

export function changeVNCAccessProfileRoute(
  draft: VNCAccessProfileDraft,
  route: RemoteDesktopRoute,
  defaultSSHProfileId = '',
): VNCAccessProfileDraft {
  if (route === draft.route) {
    return draft
  }
  const routeMemory = {
    ssh_profile_id: draft.route === 'ssh_tunnel'
      ? draft.ssh_profile_id
      : draft.route_memory?.ssh_profile_id ?? '',
    direct_target_host: draft.route === 'direct'
      ? draft.vnc.target_host
      : draft.route_memory?.direct_target_host ?? '',
  }
  if (route === 'direct') {
    return {
      ...draft,
      route,
      ssh_profile_id: '',
      vnc: { ...draft.vnc, target_host: routeMemory.direct_target_host },
      route_memory: routeMemory,
    }
  }
  return {
    ...draft,
    route,
    ssh_profile_id: routeMemory.ssh_profile_id.trim() || defaultSSHProfileId.trim(),
    vnc: { ...draft.vnc, target_host: '127.0.0.1' },
    route_memory: routeMemory,
  }
}

function normalizeDraftValues(draft: VNCAccessProfileDraft): VNCAccessProfileDraft {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    route: draft.route,
    ssh_profile_id: draft.route === 'ssh_tunnel' ? draft.ssh_profile_id.trim() : '',
    vnc: {
      ...draft.vnc,
      target_host: draft.route === 'direct'
        ? normalizeRemoteDesktopIPAddress(draft.vnc.target_host)
        : draft.vnc.target_host.trim(),
    },
  }
}
