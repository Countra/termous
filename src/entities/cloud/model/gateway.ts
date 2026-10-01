import type { CloudAuthAction, CloudConflict, CloudDevice, CloudPreview, CloudRekeyStatus, CloudSession, CloudStatus, CloudLoginResult, CloudMFAMethod, CloudMFAStatus, CloudMFAProof, CloudMFASetup, CloudMFACodes, CloudReauthentication } from '#common/contracts'
import type { CloudProfile, CloudProfilePatch, CloudAuthorization, CloudAuthorizationKind, CloudAuthorizationInput, CloudSecurityOverview, CloudRecoveryStatus } from '#common/contracts'

export interface CloudGateway {
  security(generation: string, signal?: AbortSignal): Promise<CloudSecurityOverview>
  initializeMembership(generation: string, deviceIds: string[]): Promise<void>
  deviceRequests(generation: string, signal?: AbortSignal): Promise<CloudAuthorization[]>
  createDeviceRequest(generation: string): Promise<CloudAuthorization>
  authorization(generation: string, kind: CloudAuthorizationKind, id: string, signal?: AbortSignal): Promise<CloudAuthorization>
  authorizationAction(generation: string, kind: CloudAuthorizationKind, id: string, action: string, input: CloudAuthorizationInput): Promise<CloudAuthorization>
  recoveryOperations(generation: string, signal?: AbortSignal): Promise<CloudAuthorization[]>
  createRecovery(generation: string, kind: 'enablement' | 'recovery'): Promise<CloudAuthorization>
  recoveryPolicy(generation: string, action: 'disable' | 'freeze' | 'unfreeze', revision: string, proof: CloudMFAProof): Promise<CloudRecoveryStatus>
  emergencyFreeze(generation: string): Promise<void>
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
