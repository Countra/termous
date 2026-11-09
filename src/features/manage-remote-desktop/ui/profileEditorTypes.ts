import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { VNCTargetAuthDraft, VNCTargetAuthDraftError } from '../model/vncTargetAuthDraft.ts'

export interface DesktopProfileEditorOptions {
  submitted: boolean
  disabled: boolean
  sshProfiles: SSHAccessProfile[]
  hasSavedTargetAuth: boolean
  targetAuthDraft: VNCTargetAuthDraft
  targetAuthError?: VNCTargetAuthDraftError
  onTargetAuthChange: (draft: VNCTargetAuthDraft) => void
}
