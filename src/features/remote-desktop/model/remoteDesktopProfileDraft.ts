import type {
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
  VncProfileSettings,
} from '#entities/remote-desktop'

export interface RemoteDesktopProfileDraft extends Omit<RemoteDesktopProfileInput, 'vnc'> {
  vnc: Omit<VncProfileSettings, 'port'> & {
    port: number | null
  }
}

export interface RemoteDesktopProfileDraftErrors {
  name?: 'validationName'
  ssh_host_id?: 'validationHost'
  port?: 'validationPort'
}

const defaultDraft: RemoteDesktopProfileDraft = {
  name: '',
  description: '',
  protocol: 'vnc',
  transport: 'ssh_tunnel',
  ssh_host_id: '',
  vnc: {
    loopback_host: '127.0.0.1',
    port: 5900,
    shared: true,
    default_view_only: false,
    default_display_mode: 'fit',
  },
}

export function createRemoteDesktopProfileDraft(sshHostId = ''): RemoteDesktopProfileDraft {
  return {
    ...defaultDraft,
    ssh_host_id: sshHostId,
    vnc: { ...defaultDraft.vnc },
  }
}

export function remoteDesktopProfileToDraft(
  profile: RemoteDesktopProfile,
): RemoteDesktopProfileDraft {
  return {
    name: profile.name,
    description: profile.description,
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: profile.ssh_host_id,
    vnc: { ...profile.vnc },
  }
}

export function normalizeRemoteDesktopProfileDraft(
  draft: RemoteDesktopProfileDraft,
): RemoteDesktopProfileInput {
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
): RemoteDesktopProfileDraftErrors {
  const errors: RemoteDesktopProfileDraftErrors = {}
  if (!draft.name.trim()) {
    errors.name = 'validationName'
  }
  if (!draft.ssh_host_id || (availableHostIds && !availableHostIds.has(draft.ssh_host_id))) {
    errors.ssh_host_id = 'validationHost'
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
    && left.protocol === right.protocol
    && left.transport === right.transport
    && left.ssh_host_id === right.ssh_host_id
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
