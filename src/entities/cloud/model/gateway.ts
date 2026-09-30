import type { CloudAuthAction, CloudChallenge, CloudConflict, CloudDevice, CloudPreview, CloudRekeyStatus, CloudSession, CloudStatus, CloudLoginResult, CloudMFAMethod, CloudMFAStatus, CloudMFAProof, CloudMFASetup, CloudMFACodes, CloudReauthentication } from '#common/contracts'
import type { CloudProfile, CloudProfilePatch } from '#common/contracts'

export interface CloudGateway {
  profile(generation: string, signal?: AbortSignal): Promise<CloudProfile>
  updateProfile(generation: string, patch: CloudProfilePatch, signal?: AbortSignal): Promise<CloudProfile>
  getStatus(): CloudStatus | undefined
  subscribeStatus(listener: () => void): () => void
  acceptStatus(value: CloudStatus): boolean
  status(signal?: AbortSignal): Promise<CloudStatus>
  eventsUrl(): string
  login(generation: string, email: string, password: string): Promise<CloudLoginResult>
  verifyLogin(generation: string, challengeId: string, method: CloudMFAMethod, code: string): Promise<CloudLoginResult>
  cancelLogin(generation: string, challengeId: string): Promise<void>
  logout(generation: string): Promise<CloudStatus>
  auth(action: CloudAuthAction, input: { generation: string; email?: string; password?: string; token?: string }): Promise<void>
  reauthenticate(generation: string, proof: CloudMFAProof): Promise<CloudReauthentication>
  mfaStatus(generation: string, signal?: AbortSignal): Promise<CloudMFAStatus>
  mfaSetup(generation: string, revision: string, proof: CloudMFAProof): Promise<CloudMFASetup>
  mfaConfirm(generation: string, revision: string, setupId: string, code: string): Promise<CloudMFACodes>
  mfaCancel(generation: string, revision: string, setupId: string): Promise<CloudMFAStatus>
  mfaDisable(generation: string, revision: string, proof: CloudMFAProof): Promise<CloudMFAStatus>
  mfaRegenerate(generation: string, revision: string, proof: CloudMFAProof): Promise<CloudMFACodes>
  devices(): Promise<CloudDevice[]>
  sessions(): Promise<CloudSession[]>
  pairing(generation: string): Promise<{ challenge: CloudChallenge; fingerprint: string }>
  approve(generation: string, challenge: CloudChallenge, fingerprint: string): Promise<{ trust_root: string }>
  accept(generation: string, trustRoot: string): Promise<CloudStatus>
  revokeDevice(generation: string, id: string): Promise<void>
  revokeSession(generation: string, id: string): Promise<void>
  preview(generation: string): Promise<CloudPreview>
  confirm(generation: string, previewId: string): Promise<CloudStatus>
  run(generation: string): Promise<CloudStatus>
  conflicts(): Promise<CloudConflict[]>
  resolve(generation: string, id: string, choice: 'local' | 'remote'): Promise<void>
  rekeyStatus(): Promise<CloudRekeyStatus>
  rekey(generation: string, action: 'start' | 'resume' | 'cancel'): Promise<CloudRekeyStatus>
}
