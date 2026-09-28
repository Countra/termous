import type { FileAccessEngine, FileAccessProfile } from './types.ts'
import { getSFTPAccessConfig } from './fileAccessProfile.ts'

export interface FileAccessTechnologyDescriptor {
  id: FileAccessEngine
  label: string
  shortLabel?: string
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

export function getFileAccessTechnologyDescriptor(engine: FileAccessEngine, configVersion: number): FileAccessTechnologyDescriptor {
  if (engine === 'sftp') return { id: engine, label: 'SFTP', editable: configVersion === 1 }
  if (engine === 's3') return { id: engine, label: 'S3 / MinIO', editable: configVersion === 1 }
  if (engine === 'webdav') return { id: engine, label: 'WebDAV', shortLabel: 'DAV', editable: configVersion === 1 }
  if (engine === 'ftp') return { id: engine, label: 'FTP', editable: configVersion === 1 }
  if (engine === 'smb') return { id: engine, label: 'SMB', editable: configVersion === 1 }
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
    ...(profile.engine === 'smb' && profile.engine_config_version === 1 && typeof profile.config.host === 'string' && typeof profile.config.share === 'string' && typeof profile.config.port === 'number'
      ? { endpoint: `SMB · ${profile.config.host.includes(':') && !profile.config.host.startsWith('[') ? `[${profile.config.host}]` : profile.config.host}:${profile.config.port} / ${profile.config.share} · ${profile.config.root_path || '/'}` }
      : {}),
    ...(profile.engine === 'ftp' && profile.engine_config_version === 1 && typeof profile.config.host === 'string' && typeof profile.config.port === 'number'
      ? { endpoint: `${profile.config.security === 'none' ? 'FTP' : profile.config.security === 'implicit_tls' ? 'FTPS (TLS)' : 'FTPS (AUTH TLS)'} · ${profile.config.host.includes(':') && !profile.config.host.startsWith('[') ? `[${profile.config.host}]` : profile.config.host}:${profile.config.port} · ${profile.config.root_path || '/'}` }
      : {}),
    ...(profile.engine === 'webdav' && profile.engine_config_version === 1 && typeof profile.config.endpoint === 'string' && typeof profile.config.username === 'string'
      ? { endpoint: `${profile.config.endpoint} · ${profile.config.username}` }
      : {}),
    routeDependency: sshProfileId ? { kind: 'ssh_profile', profileId: sshProfileId } : undefined,
    isDefault: profile.is_default,
    sortOrder: profile.sort_order,
  }
}
