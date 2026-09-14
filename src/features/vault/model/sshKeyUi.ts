import type { TFunction } from 'i18next'
import type { SSHKeyInfo } from '#entities/credential'
import { TermousApiError } from '#shared/api'

const SSH_PRIVATE_KEY_FILE_MAX_BYTES = 1 << 20

interface PrivateKeyFileSource {
  readonly name: string
  readonly size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface PrivateKeyImportSource {
  fileName: string
  privateKey: string
}

function assertPrivateKeyFileSize(size: number) {
  if (size <= 0) {
    throw new Error('ssh_private_key_empty')
  }
  if (size > SSH_PRIVATE_KEY_FILE_MAX_BYTES) {
    throw new Error('ssh_private_key_too_large')
  }
}

export async function readDroppedPrivateKeyFile(file: PrivateKeyFileSource): Promise<PrivateKeyImportSource> {
  assertPrivateKeyFileSize(file.size)
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new Error('ssh_private_key_read_failed')
  }

  const bytes = new Uint8Array(buffer)
  try {
    assertPrivateKeyFileSize(bytes.byteLength)
    return {
      fileName: file.name,
      privateKey: new TextDecoder().decode(bytes),
    }
  } finally {
    bytes.fill(0)
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
