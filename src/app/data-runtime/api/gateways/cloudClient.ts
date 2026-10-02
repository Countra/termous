import type { CloudAuthAction, CloudStatus, CloudMFAMethod, CloudMFAProof } from '#common/contracts'
import type { CloudProfilePatch } from '#common/contracts'
import { decodeCloudProfile } from '#entities/cloud'
import { CloudState, decodeCloudStatus, decodeCloudList, decodeCloudDevice, decodeCloudSession, decodeCloudPreview, decodeCloudConflict, decodeCloudRekey, type CloudGateway } from '#entities/cloud'
import { decodeCloudLogin, decodeCloudMFAStatus, decodeCloudMFASetup, decodeCloudMFACodes, decodeCloudReauthentication } from '#entities/cloud'
import { TermousApiTransport } from '#shared/api'
import type { CloudAuthorizationKind, CloudAuthorizationAction, CloudAuthorizationInput } from '#common/contracts'
import { decodeCloudAuthorization, decodeCloudSecurity, decodeCloudRecoveryStatus } from '#entities/cloud'
import { decodePersonalStatus, decodePersonalSetup, decodePersonalOperation, decodeWorkspaceRestart, decodeArchive, decodeArchivePreview } from '#entities/cloud'

export class CloudClient extends TermousApiTransport implements CloudGateway {
  personalRecoveryStatus(generation: string, signal?: AbortSignal) { return this.request(`/api/v1/cloud/personal-recovery?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(decodePersonalStatus) }
  setupPersonalRecovery(generation: string, proof: CloudMFAProof) { return this.request('/api/v1/cloud/personal-recovery/setup', { method: 'POST', body: { generation, ...proof }, timeoutMs: 125_000 }).then(decodePersonalSetup) }
  confirmPersonalRecovery(generation: string, id: string, answers: string[]) { return this.request('/api/v1/cloud/personal-recovery/setup/confirm', { method: 'POST', body: { generation, id, answers }, timeoutMs: 125_000 }).then(decodePersonalOperation) }
  recoverPersonal(generation: string, recoveryKey: string, revokeDeviceIds: string[]) { return this.request('/api/v1/cloud/personal-recovery/recover', { method: 'POST', body: { generation, recovery_key: recoveryKey, revoke_device_ids: revokeDeviceIds }, timeoutMs: 125_000 }).then(decodePersonalOperation) }
  personalOperation(generation: string, kind: 'setup' | 'recover', id: string, signal?: AbortSignal) { return this.request(`/api/v1/cloud/personal-recovery/${kind}/${encodeURIComponent(id)}?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(decodePersonalOperation) }
  cancelPersonalRecovery(generation: string, kind: 'setup' | 'recover', id: string) { return this.request(`/api/v1/cloud/personal-recovery/${kind}/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { generation, expected_revision: '0' }, timeoutMs: 125_000 }).then(decodePersonalOperation) }
  createWorkspaceRestart(generation: string) { return this.request('/api/v1/cloud/workspace-restarts', { method: 'POST', body: { generation }, timeoutMs: 125_000 }).then(decodeWorkspaceRestart) }
  workspaceRestart(generation: string, id: string, signal?: AbortSignal) { return this.request(`/api/v1/cloud/workspace-restarts/${encodeURIComponent(id)}?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(decodeWorkspaceRestart) }
  sendRestartEmail(generation: string, id: string, revision: number) { return this.request(`/api/v1/cloud/workspace-restarts/${encodeURIComponent(id)}/email`, { method: 'POST', body: { generation, expected_revision: revision }, timeoutMs: 125_000 }).then(decodeWorkspaceRestart) }
  verifyRestart(generation: string, id: string, revision: number, emailToken: string, proof: CloudMFAProof) { return this.request(`/api/v1/cloud/workspace-restarts/${encodeURIComponent(id)}/verify`, { method: 'POST', body: { generation, expected_revision: revision, email_token: emailToken, ...proof }, timeoutMs: 125_000 }).then(decodeWorkspaceRestart) }
  async completeRestart(generation: string, id: string, revision: number) {
    try { return decodeWorkspaceRestart(await this.request(`/api/v1/cloud/workspace-restarts/${encodeURIComponent(id)}/complete`, { method: 'POST', body: { generation, expected_revision: revision, confirm: true }, timeoutMs: 125_000 })) }
    // 切换失败也可能已经产生新代次；状态补读不能覆盖原操作的结果或错误。
    finally { await Promise.allSettled([this.status()]) }
  }
  cancelRestart(generation: string, id: string, revision: number) { return this.request(`/api/v1/cloud/workspace-restarts/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { generation, expected_revision: revision }, timeoutMs: 125_000 }).then(decodeWorkspaceRestart) }
  joinCurrentWorkspace(generation: string) { return this.readStatus(this.request('/api/v1/cloud/workspace/join', { method: 'POST', body: { generation }, timeoutMs: 125_000 })) }
  archives(generation: string, signal?: AbortSignal) { return this.request(`/api/v1/cloud/workspace-archives?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(value => decodeCloudList(value, decodeArchive)) }
  previewArchive(generation: string, workspaceId: string, recoveryKey: string) { return this.request('/api/v1/cloud/workspace-archives/preview', { method: 'POST', body: { generation, workspace_id: workspaceId, recovery_key: recoveryKey }, timeoutMs: 125_000 }).then(decodeArchivePreview) }
  applyArchive(generation: string, id: string, choices: Record<string, 'local' | 'remote'>) { return this.readStatus(this.request('/api/v1/cloud/workspace-archives/apply', { method: 'POST', body: { generation, id, choices }, timeoutMs: 125_000 })) }
  async deleteArchive(generation: string, workspaceId: string, revision: string) { await this.request('/api/v1/cloud/workspace-archives/delete', { method: 'POST', body: { generation, workspace_id: workspaceId, expected_revision: revision, confirm: true }, timeoutMs: 125_000 }) }
  security(generation: string, signal?: AbortSignal) {
    return this.request(`/api/v1/cloud/security?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(decodeCloudSecurity)
  }
  async initializeMembership(generation: string, deviceIds: string[]) {
    await this.request('/api/v1/cloud/membership/initialize', { method: 'POST', body: { generation, device_ids: deviceIds }, timeoutMs: 125_000 })
  }
  deviceRequests(generation: string, signal?: AbortSignal) {
    return this.request(`/api/v1/cloud/device-requests?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(value => decodeCloudList(value, decodeCloudAuthorization))
  }
  createDeviceRequest(generation: string) {
    return this.request('/api/v1/cloud/device-requests', { method: 'POST', body: { generation }, timeoutMs: 125_000 }).then(decodeCloudAuthorization)
  }
  private authorizationPath(kind: CloudAuthorizationKind, id: string) {
    return kind === 'approval' ? `/api/v1/cloud/device-requests/${encodeURIComponent(id)}` : `/api/v1/cloud/managed-recovery/${kind}/${encodeURIComponent(id)}`
  }
  authorization(generation: string, kind: CloudAuthorizationKind, id: string, signal?: AbortSignal) {
    return this.request(`${this.authorizationPath(kind, id)}?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(decodeCloudAuthorization)
  }
  authorizationAction(generation: string, kind: CloudAuthorizationKind, id: string, action: CloudAuthorizationAction, input: CloudAuthorizationInput) {
    return this.request(`${this.authorizationPath(kind, id)}/${encodeURIComponent(action)}`, { method: 'POST', body: { generation, ...input }, timeoutMs: 125_000 }).then(decodeCloudAuthorization)
  }
  recoveryOperations(generation: string, signal?: AbortSignal) {
    return this.request(`/api/v1/cloud/managed-recovery/operations?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(value => decodeCloudList(value, decodeCloudAuthorization))
  }
  createRecovery(generation: string, kind: 'enablement' | 'recovery', revokeDeviceIds: string[] = []) {
    return this.request(`/api/v1/cloud/managed-recovery/${kind}`, { method: 'POST', body: { generation, revoke_device_ids: revokeDeviceIds }, timeoutMs: 125_000 }).then(decodeCloudAuthorization)
  }
  recoveryPolicy(generation: string, action: 'disable' | 'freeze' | 'unfreeze', revision: string, proof: CloudMFAProof) {
    return this.request(`/api/v1/cloud/recovery-policy/${action}`, { method: 'POST', body: { generation, expected_revision: revision, ...proof }, timeoutMs: 125_000 }).then(decodeCloudRecoveryStatus)
  }
  async emergencyFreeze(generation: string) { await this.request('/api/v1/cloud/emergency-freeze', { method: 'POST', body: { generation }, timeoutMs: 125_000 }) }
  profile(generation: string, signal?: AbortSignal) {
    return this.request(`/api/v1/cloud/profile?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(decodeCloudProfile)
  }
  updateProfile(generation: string, patch: CloudProfilePatch, signal?: AbortSignal) {
    return this.request('/api/v1/cloud/profile', { method: 'PATCH', body: { ...patch, generation }, signal, timeoutMs: 125_000 }).then(decodeCloudProfile)
  }
  private readonly state = new CloudState()
  getStatus = this.state.snapshot
  subscribeStatus = this.state.subscribe
  subscribeChanges = this.state.subscribeChanges
  acceptEvent = this.state.acceptEvent.bind(this.state)
  acceptStatus = (value: CloudStatus) => this.state.accept(value)
  private async readStatus(request: Promise<unknown>) {
    const epoch = this.state.epoch
    const value = decodeCloudStatus(await request)
    if (this.state.accept(value, epoch)) return value
    // 调用方也必须获得已合并的当前状态，通知跳转不能使用被状态层拒绝的旧账号响应。
    return this.state.snapshot()!
  }
  status(signal?: AbortSignal) { return this.readStatus(this.request('/api/v1/cloud/status', { signal })) }
  eventsUrl() { return this.websocketUrl('/api/v1/cloud/events') }
  private async readLogin(request: Promise<unknown>) {
    const epoch = this.state.epoch
    const value = decodeCloudLogin(await request)
    if (value.state === 'mfa_required') {
      if (epoch !== this.state.epoch) throw new Error('CLOUD_STALE')
      return value
    }
    if (this.state.accept(value.status, epoch)) return value
    const current = this.state.snapshot()
    if (current?.generation === value.status.generation) return { state: 'authenticated' as const, status: current }
    throw new Error('CLOUD_STALE')
  }
  login(generation: string, email: string, password: string) {
    return this.readLogin(this.request('/api/v1/cloud/auth/login', { method: 'POST', body: { generation, email, password }, timeoutMs: 125_000 }))
  }
  verifyLogin(generation: string, challengeId: string, method: CloudMFAMethod, code: string) {
    return this.readLogin(this.request('/api/v1/cloud/auth/login/verify', { method: 'POST', body: { generation, challenge_id: challengeId, method, code }, timeoutMs: 125_000 }))
  }
  async cancelLogin(generation: string, challengeId: string) {
    await this.request('/api/v1/cloud/auth/login/cancel', { method: 'POST', body: { generation, challenge_id: challengeId } })
  }
  logout(generation: string) { return this.readStatus(this.request('/api/v1/cloud/auth/logout', { method: 'POST', body: { generation }, timeoutMs: 125_000 })) }
  async auth(action: CloudAuthAction, input: { generation: string; email?: string; password?: string; token?: string }) {
    await this.request(`/api/v1/cloud/auth/${action}`, { method: 'POST', body: input, timeoutMs: 125_000 })
  }
  reauthenticate(generation: string, proof: CloudMFAProof) {
    return this.request('/api/v1/cloud/auth/reauthenticate', { method: 'POST', body: { generation, ...proof }, timeoutMs: 125_000 }).then(decodeCloudReauthentication)
  }
  mfaStatus(generation: string, signal?: AbortSignal) {
    return this.request(`/api/v1/cloud/auth/mfa?generation=${encodeURIComponent(generation)}`, { signal, timeoutMs: 125_000 }).then(decodeCloudMFAStatus)
  }
  mfaSetup(generation: string, revision: string, proof: CloudMFAProof) {
    return this.request('/api/v1/cloud/auth/mfa/setup', { method: 'POST', body: { generation, expected_revision: revision, ...proof }, timeoutMs: 125_000 }).then(decodeCloudMFASetup)
  }
  mfaConfirm(generation: string, revision: string, setupId: string, code: string) {
    return this.request('/api/v1/cloud/auth/mfa/setup/confirm', { method: 'POST', body: { generation, expected_revision: revision, setup_id: setupId, code }, timeoutMs: 125_000 }).then(decodeCloudMFACodes)
  }
  mfaCancel(generation: string, revision: string, setupId: string) {
    return this.request('/api/v1/cloud/auth/mfa/setup/cancel', { method: 'POST', body: { generation, expected_revision: revision, setup_id: setupId }, timeoutMs: 125_000 }).then(decodeCloudMFAStatus)
  }
  mfaDisable(generation: string, revision: string, proof: CloudMFAProof) {
    return this.request('/api/v1/cloud/auth/mfa/disable', { method: 'POST', body: { generation, expected_revision: revision, ...proof }, timeoutMs: 125_000 }).then(decodeCloudMFAStatus)
  }
  mfaRegenerate(generation: string, revision: string, proof: CloudMFAProof) {
    return this.request('/api/v1/cloud/auth/mfa/backup-codes/regenerate', { method: 'POST', body: { generation, expected_revision: revision, ...proof }, timeoutMs: 125_000 }).then(decodeCloudMFACodes)
  }
  devices() { return this.request('/api/v1/cloud/devices', { timeoutMs: 125_000 }).then((value) => decodeCloudList(value, decodeCloudDevice)) }
  sessions() { return this.request('/api/v1/cloud/sessions', { timeoutMs: 125_000 }).then((value) => decodeCloudList(value, decodeCloudSession)) }
  async revokeDevice(generation: string, id: string) { await this.request(`/api/v1/cloud/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: { generation }, timeoutMs: 125_000 }) }
  async revokeSession(generation: string, id: string) { await this.request(`/api/v1/cloud/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: { generation }, timeoutMs: 125_000 }) }
  preview(generation: string) { return this.request('/api/v1/cloud/sync/preview', { method: 'POST', body: { generation }, timeoutMs: 125_000 }).then(decodeCloudPreview) }
  confirm(generation: string, previewId: string) { return this.readStatus(this.request('/api/v1/cloud/sync/confirm', { method: 'POST', body: { generation, preview_id: previewId }, timeoutMs: 125_000 })) }
  run(generation: string) { return this.readStatus(this.request('/api/v1/cloud/sync/run', { method: 'POST', body: { generation }, timeoutMs: 125_000 })) }
  conflicts() { return this.request('/api/v1/cloud/conflicts').then((value) => decodeCloudList(value, decodeCloudConflict)) }
  async resolve(generation: string, id: string, choice: 'local' | 'remote') { await this.request(`/api/v1/cloud/conflicts/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { generation, choice } }) }
  rekeyStatus() { return this.request('/api/v1/cloud/rekey').then(decodeCloudRekey) }
  rekey(generation: string, action: 'start' | 'resume' | 'cancel') { return this.request(`/api/v1/cloud/rekey/${action}`, { method: 'POST', body: { generation }, timeoutMs: 125_000 }).then(decodeCloudRekey) }
}
