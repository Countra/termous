import type { FileAccessEngine, FileAccessProfile } from './types.ts'

export interface FileAccessTechnologyDescriptor {
  id: FileAccessEngine
  label: string
}

export interface FileAccessProfileProjection {
  profileId: string
  hostId: string
  name: string
  technology: FileAccessTechnologyDescriptor
  routeDependency: {
    kind: 'ssh_profile'
    profileId: string
  }
  isDefault: boolean
  sortOrder: number
}

const technologyDescriptors = {
  sftp: { id: 'sftp', label: 'SFTP' },
} satisfies Record<FileAccessEngine, FileAccessTechnologyDescriptor>

type FileAccessProfileProjectors = {
  [Engine in FileAccessEngine]: (
    profile: Extract<FileAccessProfile, { engine: Engine }>,
  ) => FileAccessProfileProjection
}

const profileProjectors = {
  sftp: (profile) => ({
    profileId: profile.id,
    hostId: profile.host_id,
    name: profile.name,
    technology: technologyDescriptors.sftp,
    routeDependency: {
      kind: 'ssh_profile',
      profileId: profile.sftp.ssh_profile_id,
    },
    isDefault: profile.is_default,
    sortOrder: profile.sort_order,
  }),
} satisfies FileAccessProfileProjectors

export function getFileAccessTechnologyDescriptor(engine: FileAccessEngine) {
  return technologyDescriptors[engine]
}

export function projectFileAccessProfile(
  profile: FileAccessProfile,
): FileAccessProfileProjection {
  const projector = profileProjectors[profile.engine] as (
    candidate: FileAccessProfile,
  ) => FileAccessProfileProjection
  return projector(profile)
}
