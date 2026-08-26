import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
} from '#entities/remote-desktop'
import {
  applyVNCTargetAuthDraft,
  isVNCTargetAuthDraftDirty,
  type VNCTargetAuthDraft,
  type VNCTargetAuthMutationGateway,
} from './vncTargetAuthDraft.ts'

interface VNCProfilePersistenceGateway extends VNCTargetAuthMutationGateway {
  createRemoteDesktopProfile: (
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  updateRemoteDesktopProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
}

interface PersistVNCProfileOptions {
  input: RemoteDesktopAccessProfileInput
  existingProfile: RemoteDesktopAccessProfile | null
  metadataDirty: boolean
  targetAuthDraft: VNCTargetAuthDraft
  gateway: VNCProfilePersistenceGateway
  beforeTargetAuth?: (profile: RemoteDesktopAccessProfile) => Promise<void>
}

export interface PersistedVNCProfileResult {
  profile: RemoteDesktopAccessProfile
  metadataSaved: boolean
}

export class VNCTargetAuthPersistenceError extends Error {
  readonly profile: RemoteDesktopAccessProfile
  readonly metadataSaved: boolean
  readonly cause: unknown

  constructor(profile: RemoteDesktopAccessProfile, metadataSaved: boolean, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'VNCTargetAuthPersistenceError'
    this.profile = profile
    this.metadataSaved = metadataSaved
    this.cause = cause
  }
}

export async function persistVNCProfile({
  input,
  existingProfile,
  metadataDirty,
  targetAuthDraft,
  gateway,
  beforeTargetAuth,
}: PersistVNCProfileOptions): Promise<PersistedVNCProfileResult> {
  const metadataSaved = !existingProfile || metadataDirty
  let profile: RemoteDesktopAccessProfile
  if (!existingProfile) {
    profile = await gateway.createRemoteDesktopProfile(input)
  } else if (metadataDirty) {
    profile = await gateway.updateRemoteDesktopProfile(
      existingProfile.id,
      existingProfile.updated_at,
      input,
    )
  } else {
    profile = existingProfile
  }

  if (!isVNCTargetAuthDraftDirty(targetAuthDraft)) {
    return { profile, metadataSaved }
  }
  try {
    if (metadataSaved) {
      await beforeTargetAuth?.(profile)
    }
    profile = await applyVNCTargetAuthDraft(profile, targetAuthDraft, gateway)
    return { profile, metadataSaved }
  } catch (cause) {
    throw new VNCTargetAuthPersistenceError(profile, metadataSaved, cause)
  }
}
