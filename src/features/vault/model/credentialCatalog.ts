import type { CredentialInput, CredentialType, CredentialView } from '#entities/credential'

export type CredentialCatalogFilter = 'all' | CredentialType

export interface CredentialValidationErrors {
  name?: string
  secret?: string
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
