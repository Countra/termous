import type { TFunction } from 'i18next'
import { TermousApiError } from '../../api/client'
import type { CredentialInput, SSHKeyInfo } from '../../types/domain'

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

export function privateKeyNameFromFile(fileName: string | undefined, fallbackName: string) {
  const name = fileName?.trim().replace(/\.(key|pem|openssh)$/i, '')
  return name || fallbackName
}

export function sshKeyErrorMessage(error: unknown, t: TFunction) {
  const code = error instanceof TermousApiError ? error.code : error instanceof Error ? error.message : ''
  const normalized = code.toLocaleLowerCase()
  const knownCodes = [
    'invalid_algorithm',
    'invalid_parameter',
    'invalid_key',
    'unsupported_key',
    'passphrase_required',
    'invalid_passphrase',
    'input_too_large',
    'request_timeout',
    'network_error',
    'ssh_private_key_not_regular_file',
    'ssh_private_key_empty',
    'ssh_private_key_too_large',
    'ssh_private_key_read_failed',
    'ssh_key_file_conflict',
    'ssh_key_file_write_failed',
    'ssh_key_pair_write_failed',
    'ssh_key_pair_rollback_failed',
  ]
  const matched = knownCodes.find((item) => normalized.includes(item))
  return t(`vault.sshKey.errors.${matched ?? 'unknown'}`)
}

export function sshKeyAlgorithmSummary(info: SSHKeyInfo, t: TFunction) {
  if (info.algorithm === 'rsa' && info.bits) {
    return `RSA ${info.bits}`
  }
  if (info.algorithm === 'ecdsa' && info.curve) {
    return `ECDSA ${info.curve.toUpperCase()}`
  }
  return t(`vault.sshKey.algorithm.${info.algorithm}`)
}
