import type {
  FileAccessProfile,
  FileAccessProfileMetadataInput,
  FileAccessProfileValidationErrors,
  SFTPAccessConfig,
} from './types.ts'

const MAX_PROFILE_NAME_LENGTH = 80

export function fileAccessProfileToMetadataInput(
  profile: FileAccessProfile,
): FileAccessProfileMetadataInput {
  return { name: profile.name }
}

export function normalizeFileAccessProfileMetadataInput(
  input: FileAccessProfileMetadataInput,
): FileAccessProfileMetadataInput {
  return { name: input.name.trim() }
}

export function fileAccessProfileMetadataInputsEqual(
  left: FileAccessProfileMetadataInput,
  right: FileAccessProfileMetadataInput,
) {
  return normalizeFileAccessProfileMetadataInput(left).name === normalizeFileAccessProfileMetadataInput(right).name
}

export function validateFileAccessProfileMetadataInput(
  input: FileAccessProfileMetadataInput,
): FileAccessProfileValidationErrors {
  const name = input.name.trim()
  if (!name) {
    return { name: 'required' }
  }
  if (Array.from(name).length > MAX_PROFILE_NAME_LENGTH) {
    return { name: 'too_long' }
  }
  return {}
}

export function sortFileAccessProfiles(profiles: FileAccessProfile[]) {
  return [...profiles].sort((left, right) => (
    (left.host_id ?? '').localeCompare(right.host_id ?? '')
    || left.sort_order - right.sort_order
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ))
}

export function selectDefaultFileAccessProfile(
  profiles: FileAccessProfile[],
  hostId: string,
) {
  const defaults = profiles.filter((profile) => profile.host_id === hostId && profile.is_default)
  return defaults.length === 1 ? defaults[0] : undefined
}

export function getSFTPAccessConfig(profile: FileAccessProfile): SFTPAccessConfig | undefined {
  if (profile.engine !== 'sftp' || profile.engine_config_version !== 1) return undefined
  if (!profile.config || typeof profile.config !== 'object' || Array.isArray(profile.config)) return undefined
  const keys = Object.keys(profile.config)
  const sshProfileId = profile.config.ssh_profile_id
  if (keys.length !== 1 || keys[0] !== 'ssh_profile_id' || typeof sshProfileId !== 'string' || !sshProfileId) {
    return undefined
  }
  if (profile.sftp && profile.sftp.ssh_profile_id !== sshProfileId) return undefined
  return { ssh_profile_id: sshProfileId }
}

export function selectCompanionSFTPFileAccessProfile(
  profiles: FileAccessProfile[],
  hostId: string,
  sshProfileId: string,
) {
  if (!hostId || !sshProfileId) {
    return undefined
  }
  const matches = profiles.filter((profile) => (
    profile.host_id === hostId
    && getSFTPAccessConfig(profile)?.ssh_profile_id === sshProfileId
  ))
  return matches.length === 1 ? matches[0] : undefined
}
