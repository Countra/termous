import type {
  SSHAccessProfile,
  SSHAccessProfileDraft,
  SSHAccessProfileInput,
  SSHAccessProfileValidationErrors,
} from './types.ts'

const MAX_ADDRESS_LENGTH = 253
const MAX_PROFILE_NAME_LENGTH = 80
const MAX_USERNAME_LENGTH = 256

export function createSSHAccessProfileDraft(): SSHAccessProfileDraft {
  return {
    name: '',
    address: '',
    port: 22,
    username: '',
    auth_method: 'password',
    credential_id: '',
    proxy_id: '',
    jump_ssh_profile_id: '',
    fingerprint: '',
    fingerprint_policy: 'confirm_on_change',
  }
}

export function sshAccessProfileToDraft(profile: SSHAccessProfile): SSHAccessProfileDraft {
  return {
    name: profile.name,
    address: profile.address,
    port: profile.port,
    username: profile.username,
    auth_method: profile.auth_method,
    credential_id: profile.credential_id,
    proxy_id: profile.proxy_id ?? '',
    jump_ssh_profile_id: profile.jump_ssh_profile_id ?? '',
    fingerprint: profile.fingerprint ?? '',
    fingerprint_policy: profile.fingerprint_policy,
  }
}

export function normalizeSSHAccessProfileDraft(draft: SSHAccessProfileDraft): SSHAccessProfileInput {
  return {
    name: draft.name.trim(),
    address: draft.address.trim(),
    port: draft.port ?? 0,
    username: draft.username.trim(),
    auth_method: draft.auth_method,
    credential_id: draft.credential_id.trim(),
    proxy_id: draft.proxy_id.trim(),
    jump_ssh_profile_id: draft.jump_ssh_profile_id.trim(),
    fingerprint: draft.fingerprint.trim(),
    fingerprint_policy: draft.fingerprint_policy.trim() || 'confirm_on_change',
  }
}

export function sshAccessProfileDraftsEqual(
  left: SSHAccessProfileDraft,
  right: SSHAccessProfileDraft,
) {
  return JSON.stringify(normalizeSSHAccessProfileDraft(left)) === JSON.stringify(normalizeSSHAccessProfileDraft(right))
}

export function validateSSHAccessProfileDraft(
  draft: SSHAccessProfileDraft,
  editingProfileId = '',
): SSHAccessProfileValidationErrors {
  const errors: SSHAccessProfileValidationErrors = {}
  const name = draft.name.trim()
  const address = draft.address.trim()
  const username = draft.username.trim()
  if (Array.from(name).length > MAX_PROFILE_NAME_LENGTH) {
    errors.name = 'too_long'
  }
  if (!address) {
    errors.address = 'required'
  } else if (new TextEncoder().encode(address).byteLength > MAX_ADDRESS_LENGTH) {
    errors.address = 'too_long'
  }
  if (!Number.isSafeInteger(draft.port) || (draft.port ?? 0) < 1 || (draft.port ?? 0) > 65535) {
    errors.port = 'range'
  }
  if (!username) {
    errors.username = 'required'
  } else if (new TextEncoder().encode(username).byteLength > MAX_USERNAME_LENGTH) {
    errors.username = 'too_long'
  }
  if (!draft.credential_id.trim()) {
    errors.credential_id = 'required'
  }
  if (editingProfileId && draft.jump_ssh_profile_id.trim() === editingProfileId) {
    errors.jump_ssh_profile_id = 'self_reference'
  }
  return errors
}

export function sortSSHAccessProfiles(profiles: SSHAccessProfile[]) {
  return [...profiles].sort((left, right) => (
    left.host_id.localeCompare(right.host_id)
    || left.sort_order - right.sort_order
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ))
}

export function selectDefaultSSHAccessProfile(
  profiles: SSHAccessProfile[],
  hostId: string,
) {
  const defaults = profiles.filter((profile) => profile.host_id === hostId && profile.is_default)
  return defaults.length === 1 ? defaults[0] : undefined
}
