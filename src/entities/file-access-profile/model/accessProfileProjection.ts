import type { FileAccessEngine, FileAccessProfile } from './types.ts'
import { getSFTPAccessConfig } from './fileAccessProfile.ts'

export interface FileAccessTechnologyDescriptor {
  id: FileAccessEngine
  label: string
  editable: boolean
}

export interface FileAccessProfileProjection {
  profileId: string
  hostId?: string
  name: string
  endpoint?: string
  technology: FileAccessTechnologyDescriptor
  routeDependency?: {
    kind: 'ssh_profile'
    profileId: string
  }
  isDefault: boolean
  sortOrder: number
}

export function getFileAccessTechnologyDescriptor(engine: FileAccessEngine, configVersion: number) {
  if (engine === 'sftp') return { id: engine, label: 'SFTP', editable: configVersion === 1 }
  if (engine === 's3') return { id: engine, label: 'S3 / MinIO', editable: configVersion === 1 }
  return { id: engine, label: engine.toUpperCase(), editable: false }
}

export function projectFileAccessProfile(
  profile: FileAccessProfile,
): FileAccessProfileProjection {
  const sshProfileId = getSFTPAccessConfig(profile)?.ssh_profile_id
  return {
    profileId: profile.id,
    hostId: profile.host_id,
    name: profile.name,
    ...(profile.engine === 's3' && profile.engine_config_version === 1 && typeof profile.config.endpoint === 'string' && typeof profile.config.bucket === 'string'
      ? { endpoint: `${profile.config.endpoint} / ${profile.config.bucket}${profile.config.prefix ? ` / ${profile.config.prefix}` : ''}` }
      : {}),
    technology: getFileAccessTechnologyDescriptor(profile.engine, profile.engine_config_version),
    routeDependency: sshProfileId ? { kind: 'ssh_profile', profileId: sshProfileId } : undefined,
    isDefault: profile.is_default,
    sortOrder: profile.sort_order,
  }
}
