import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'

export const vncTargetAuthPasswordMaxBytes = 4_096

export type VNCTargetAuthMutation = 'keep' | 'replace' | 'remove'

export interface VNCTargetAuthDraft {
  mutation: VNCTargetAuthMutation
  password: string
}

export type VNCTargetAuthDraftError = 'required' | 'too_large'

export interface VNCTargetAuthMutationGateway {
  saveRemoteDesktopTargetAuth: (
    id: string,
    expectedUpdatedAt: string,
    password: string,
  ) => Promise<RemoteDesktopAccessProfile>
  deleteRemoteDesktopTargetAuth: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<RemoteDesktopAccessProfile>
}

export function createVNCTargetAuthDraft(): VNCTargetAuthDraft {
  return { mutation: 'keep', password: '' }
}

export function isVNCTargetAuthDraftDirty(draft: VNCTargetAuthDraft) {
  return draft.mutation !== 'keep'
}

export function validateVNCTargetAuthDraft(
  draft: VNCTargetAuthDraft,
): VNCTargetAuthDraftError | undefined {
  if (draft.mutation !== 'replace') return undefined
  if (draft.password.length === 0) return 'required'
  if (new TextEncoder().encode(draft.password).byteLength > vncTargetAuthPasswordMaxBytes) {
    return 'too_large'
  }
  return undefined
}

export async function applyVNCTargetAuthDraft(
  profile: RemoteDesktopAccessProfile,
  draft: VNCTargetAuthDraft,
  gateway: VNCTargetAuthMutationGateway,
) {
  if (draft.mutation === 'replace') {
    return gateway.saveRemoteDesktopTargetAuth(profile.id, profile.updated_at, draft.password)
  }
  if (draft.mutation === 'remove') {
    return gateway.deleteRemoteDesktopTargetAuth(profile.id, profile.updated_at)
  }
  return profile
}
