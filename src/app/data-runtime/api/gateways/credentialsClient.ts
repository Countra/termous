import type { AppConfig } from '#common/contracts';
import type { CredentialInput, CredentialView, PrivateKeyCredentialBundleInput, PrivateKeyCredentialBundleResult, SSHKeyGenerateRequest, SSHKeyInspectRequest, SSHKeyInspectResult, SSHKeyPair } from '#entities/credential';
import { TermousApiTransport } from '#shared/api';

export class CredentialClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

credentials() {
    return this.request<CredentialView[]>('/api/v1/credentials')
  }

createCredential(input: CredentialInput) {
    const credential = toCredentialRequest(input)
    return this.request<CredentialView>('/api/v1/credentials', {
      method: 'POST',
      body: credential,
    })
  }

updateCredential(id: string, input: CredentialInput) {
    const credential = toCredentialRequest(input)
    return this.request<CredentialView>(`/api/v1/credentials/${id}`, {
      method: 'PATCH',
      body: credential,
    })
  }

deleteCredential(id: string) {
    return this.request<void>(`/api/v1/credentials/${id}`, { method: 'DELETE' })
  }

generateSSHKey(input: SSHKeyGenerateRequest, signal?: AbortSignal) {
    return this.request<SSHKeyPair>('/api/v1/credentials/ssh-keys/generate', {
      method: 'POST',
      body: input,
      signal,
    })
  }

inspectSSHKey(input: SSHKeyInspectRequest, signal?: AbortSignal) {
    return this.request<SSHKeyInspectResult>('/api/v1/credentials/ssh-keys/inspect', {
      method: 'POST',
      body: input,
      signal,
    })
  }

createPrivateKeyCredentialBundle(input: PrivateKeyCredentialBundleInput) {
    return this.request<PrivateKeyCredentialBundleResult>('/api/v1/credentials/private-key-bundles', {
      method: 'POST',
      body: input,
    })
  }
}

function toCredentialRequest(input: CredentialInput) {
  const credential = { ...input }
  delete credential.pending_passphrase
  return credential
}
