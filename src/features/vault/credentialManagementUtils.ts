import type { CredentialInput, CredentialType, CredentialView } from '../../types/domain'

export type CredentialCatalogFilter = 'all' | CredentialType

export interface CredentialValidationErrors {
  name?: string
  secret?: string
}

export function createBlankCredentialInput(type: CredentialType = 'password'): CredentialInput {
  return {
    name: '',
    type,
    vault_id: 'local',
    secret: '',
    metadata: {},
  }
}

export function credentialToInput(credential: CredentialView): CredentialInput {
  return normalizeCredentialInput({
    name: credential.name,
    type: credential.type,
    vault_id: credential.vault_id,
    secret: '',
    metadata: credential.metadata ?? {},
    ssh_key_info: credential.ssh_key_info,
  })
}

export function normalizeCredentialInput(input: CredentialInput): CredentialInput {
  const metadata = { ...input.metadata }
  const pendingPassphrase = input.type === 'private_key' && input.pending_passphrase
    ? {
        name: input.pending_passphrase.name.trim(),
        secret: input.pending_passphrase.secret,
      }
    : undefined
  if (input.type !== 'private_key' || !metadata.passphrase_credential_id?.trim()) {
    delete metadata.passphrase_credential_id
  } else {
    metadata.passphrase_credential_id = metadata.passphrase_credential_id.trim()
  }
  if (pendingPassphrase) {
    delete metadata.passphrase_credential_id
  }
  return {
    ...input,
    name: input.name.trim(),
    vault_id: input.vault_id.trim() || 'local',
    metadata,
    ssh_key_info: input.type === 'private_key' ? input.ssh_key_info : undefined,
    pending_passphrase: pendingPassphrase,
  }
}

export function credentialInputsEqual(left: CredentialInput, right: CredentialInput) {
  return JSON.stringify(normalizeCredentialInput(left)) === JSON.stringify(normalizeCredentialInput(right))
}

export function validateCredentialInput(
  input: CredentialInput,
  requireSecret: boolean,
  messages: CredentialValidationErrors,
): CredentialValidationErrors {
  const errors: CredentialValidationErrors = {}
  if (!input.name.trim()) {
    errors.name = messages.name
  }
  if (requireSecret && input.secret.length === 0) {
    errors.secret = messages.secret
  }
  return errors
}

export function filterCredentials(
  credentials: CredentialView[],
  query: string,
  filter: CredentialCatalogFilter,
  typeLabels: Record<CredentialType, string>,
) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return credentials.filter((credential) => {
    if (filter !== 'all' && credential.type !== filter) {
      return false
    }
    if (tokens.length === 0) {
      return true
    }
    const searchable = [credential.name, typeLabels[credential.type], credential.ssh_key_info?.algorithm ?? '']
      .join(' ')
      .toLocaleLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
}
