import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
  VncProfileSettings,
} from '#entities/remote-desktop'

export interface VNCAccessProfileDraft {
  name: string
  description: string
  ssh_profile_id: string
  vnc: Omit<VncProfileSettings, 'port'> & { port: number | null }
}

export interface VNCAccessProfileDraftErrors {
  name?: 'required' | 'too_long'
  ssh_profile_id?: 'required' | 'missing'
  port?: 'range'
}

export function createVNCAccessProfileDraft(defaultSSHProfileId = ''): VNCAccessProfileDraft {
  return {
    name: '',
    description: '',
    ssh_profile_id: defaultSSHProfileId,
    vnc: {
      loopback_host: '127.0.0.1',
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
    ssh_profile_id: profile.ssh_profile_id,
    vnc: { ...profile.vnc },
  }
}

export function normalizeVNCAccessProfileDraft(
  hostId: string,
  draft: VNCAccessProfileDraft,
): RemoteDesktopAccessProfileInput {
  const normalized = normalizeDraftValues(draft)
  return {
    host_id: hostId,
    name: normalized.name,
    description: normalized.description,
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: normalized.ssh_profile_id,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      ...normalized.vnc,
      port: normalized.vnc.port ?? 0,
    },
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
  if (!draft.ssh_profile_id.trim()) {
    errors.ssh_profile_id = 'required'
  } else if (!availableSSHProfileIds.has(draft.ssh_profile_id)) {
    errors.ssh_profile_id = 'missing'
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

function normalizeDraftValues(draft: VNCAccessProfileDraft): VNCAccessProfileDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    ssh_profile_id: draft.ssh_profile_id.trim(),
    vnc: { ...draft.vnc },
  }
}
