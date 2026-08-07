import type {
  SSHKeyGenerateRequest,
  SSHKeyInspectRequest,
  SSHKeyInspectResult,
  SSHKeyPair,
} from '#entities/credential'

export interface CredentialGateway {
  generateSSHKey(input: SSHKeyGenerateRequest, signal?: AbortSignal): Promise<SSHKeyPair>
  inspectSSHKey(input: SSHKeyInspectRequest, signal?: AbortSignal): Promise<SSHKeyInspectResult>
}

export type CredentialGatewayFactory = () => Promise<CredentialGateway>
