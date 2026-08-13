import { FileKey2, KeyRound, LockKeyhole, type LucideIcon } from 'lucide-react'
import type { CredentialType } from '../model/types.ts'

export function credentialTypeIcon(type: CredentialType): LucideIcon {
  if (type === 'private_key') {
    return FileKey2
  }
  if (type === 'private_key_passphrase') {
    return LockKeyhole
  }
  return KeyRound
}
