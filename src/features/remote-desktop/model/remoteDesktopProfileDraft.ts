import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
  VncProfileSettings,
} from '#entities/remote-desktop'

export interface RemoteDesktopProfileDraft extends Omit<RemoteDesktopAccessProfileInput, 'vnc'> {
  vnc: Omit<VncProfileSettings, 'port'> & {
    port: number | null
  }
}

export interface RemoteDesktopProfileDraftErrors {
  name?: 'validationName'
  host_id?: 'validationHost'
  ssh_profile_id?: 'validationHost'
  port?: 'validationPort'
}

const defaultDraft: RemoteDesktopProfileDraft = {
  name: '',
  description: '',
  host_id: '',
  route: 'ssh_tunnel',
  route_config_version: 1,
  ssh_profile_id: '',
  protocol: 'vnc',
  protocol_config_version: 1,
  vnc: {
    loopback_host: '127.0.0.1',
    port: 5900,
    shared: true,
    default_view_only: false,
    default_display_mode: 'fit',
  },
}

export function createRemoteDesktopProfileDraft(
  hostId = '',
  sshProfileId = '',
): RemoteDesktopProfileDraft {
  return {
    ...defaultDraft,
    host_id: hostId,
    ssh_profile_id: sshProfileId,
    vnc: { ...defaultDraft.vnc },
  }
}

export function remoteDesktopProfileToDraft(
  profile: RemoteDesktopAccessProfile,
): RemoteDesktopProfileDraft {
  return {
    name: profile.name,
    description: profile.description,
    host_id: profile.host_id,
    route: profile.route,
    route_config_version: profile.route_config_version,
    ssh_profile_id: profile.ssh_profile_id,
    protocol: 'vnc',
    protocol_config_version: profile.protocol_config_version,
    vnc: { ...profile.vnc },
  }
}

export function normalizeRemoteDesktopProfileDraft(
  draft: RemoteDesktopProfileDraft,
): RemoteDesktopAccessProfileInput {
  return {
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    vnc: {
      ...draft.vnc,
      port: draft.vnc.port ?? 0,
    },
  }
}

export function validateRemoteDesktopProfileDraft(
  draft: RemoteDesktopProfileDraft,
  availableHostIds?: ReadonlySet<string>,
  availableSSHProfileIds?: ReadonlySet<string>,
): RemoteDesktopProfileDraftErrors {
  const errors: RemoteDesktopProfileDraftErrors = {}
  if (!draft.name.trim()) {
    errors.name = 'validationName'
  }
  if (!draft.host_id || (availableHostIds && !availableHostIds.has(draft.host_id))) {
    errors.host_id = 'validationHost'
  }
  if (
    !draft.ssh_profile_id
    || (availableSSHProfileIds && !availableSSHProfileIds.has(draft.ssh_profile_id))
  ) {
    errors.ssh_profile_id = 'validationHost'
  }
  if (
    !Number.isSafeInteger(draft.vnc.port)
    || (draft.vnc.port ?? 0) < 1
    || (draft.vnc.port ?? 0) > 65535
  ) {
    errors.port = 'validationPort'
  }
  return errors
}

export function remoteDesktopProfileDraftsEqual(
  left: RemoteDesktopProfileDraft,
  right: RemoteDesktopProfileDraft,
) {
  return (
    left.name === right.name
    && left.description === right.description
    && left.host_id === right.host_id
    && left.route === right.route
    && left.route_config_version === right.route_config_version
    && left.ssh_profile_id === right.ssh_profile_id
    && left.protocol === right.protocol
    && left.protocol_config_version === right.protocol_config_version
    && left.vnc.loopback_host === right.vnc.loopback_host
    && left.vnc.port === right.vnc.port
    && left.vnc.shared === right.vnc.shared
    && left.vnc.default_view_only === right.vnc.default_view_only
    && left.vnc.default_display_mode === right.vnc.default_display_mode
  )
}

export function hasRemoteDesktopProfileDraftErrors(
  errors: RemoteDesktopProfileDraftErrors,
) {
  return Object.values(errors).some(Boolean)
}
