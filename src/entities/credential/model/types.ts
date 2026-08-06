export type CredentialType = 'password' | 'private_key' | 'private_key_passphrase'

export type SSHKeyAlgorithm = 'ed25519' | 'rsa' | 'ecdsa'

export type SSHKeyECDSACurve = 'p256' | 'p384' | 'p521'

export interface CredentialView {
  id: string
  name: string
  type: CredentialType
  vault_id: string
  metadata: Record<string, string>
  fingerprint?: string
  ssh_key_info?: SSHKeyInfo
  bound_host_count: number
  created_at?: string
  updated_at?: string
  last_used_at?: string
}

export interface CredentialInput {
  name: string
  type: CredentialType
  vault_id: string
  secret: string
  metadata: Record<string, string>
  ssh_key_info?: SSHKeyInfo
  pending_passphrase?: PendingPrivateKeyPassphrase
}

export interface SSHKeyInfo {
  public_key: string
  fingerprint_sha256: string
  algorithm: SSHKeyAlgorithm
  bits?: number
  curve?: SSHKeyECDSACurve
  comment?: string
}

export interface SSHKeyGenerateRequest {
  algorithm: SSHKeyAlgorithm
  rsa_bits?: 3072 | 4096
  ecdsa_curve?: SSHKeyECDSACurve
  comment?: string
  passphrase?: string
}

export interface SSHKeyInspectRequest {
  private_key_openssh: string
  passphrase?: string
  passphrase_credential_id?: string
}

export interface SSHKeyPair {
  private_key_openssh: string
  public_key_authorized: string
  encrypted: boolean
  info: SSHKeyInfo
}

export interface SSHKeyInspectResult {
  public_key_authorized: string
  encrypted: boolean
  info: SSHKeyInfo
}

export interface PendingPrivateKeyPassphrase {
  name: string
  secret: string
}

export interface PrivateKeyCredentialBundleInput {
  private_key: {
    name: string
    vault_id: string
    secret: string
    metadata: Record<string, string>
  }
  ssh_key_info: SSHKeyInfo
  passphrase?: PendingPrivateKeyPassphrase
  passphrase_credential_id?: string
}

export interface PrivateKeyCredentialBundleResult {
  private_key: CredentialView
  passphrase?: CredentialView
}
