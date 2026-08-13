import type { CredentialInput } from '#entities/credential'
import type { CredentialCommandGateway } from '../api/runtimeGatewayContracts'
import type { LoadMode } from '../model/appDataState'

export function createCredentialCommands(
  api: CredentialCommandGateway,
  load: (mode?: LoadMode) => Promise<void>,
) {
  return {
    async createCredential(input: CredentialInput) {
      const passphraseCredentialId = input.metadata.passphrase_credential_id?.trim()
      const privateKeyMetadata = { ...input.metadata }
      delete privateKeyMetadata.passphrase_credential_id
      const credential = input.type === 'private_key' && input.ssh_key_info
        ? (await api.createPrivateKeyCredentialBundle({
            private_key: {
              name: input.name,
              vault_id: input.vault_id,
              secret: input.secret,
              metadata: privateKeyMetadata,
            },
            ssh_key_info: input.ssh_key_info,
            passphrase: input.pending_passphrase,
            passphrase_credential_id: input.pending_passphrase ? undefined : passphraseCredentialId,
          })).private_key
        : await api.createCredential(input)
      await load('silent')
      return credential
    },
    async updateCredential(id: string, input: CredentialInput) {
      const credential = await api.updateCredential(id, input)
      await load('silent')
      return credential
    },
    async deleteCredential(id: string) {
      await api.deleteCredential(id)
      await load('silent')
    },
  }
}
