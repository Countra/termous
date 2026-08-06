import type { CredentialInput, CredentialType, CredentialView, SSHKeyInfo } from './types.ts'

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

export function buildPrivateKeyDraft(
  name: string,
  privateKey: string,
  info: SSHKeyInfo,
  passphrase?: string,
  passphraseName?: string,
): CredentialInput {
  const normalizedName = name.trim()
  return {
    name: normalizedName,
    type: 'private_key',
    vault_id: 'local',
    secret: privateKey,
    metadata: {},
    ssh_key_info: info,
    pending_passphrase: passphrase
      ? { name: passphraseName?.trim() || normalizedName, secret: passphrase }
      : undefined,
  }
}
