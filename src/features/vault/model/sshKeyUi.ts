import type { TFunction } from 'i18next'
import type { SSHKeyInfo } from '#entities/credential'
import { TermousApiError } from '#shared/api'

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
