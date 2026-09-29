import type { CloudAuthAction, CloudChallenge, CloudStatus } from '#common/contracts'
import { CloudState, decodeCloudStatus, decodeCloudList, decodeCloudDevice, decodeCloudSession, decodeCloudPairing, decodeCloudApproval, decodeCloudPreview, decodeCloudConflict, decodeCloudRekey, type CloudGateway } from '#entities/cloud'
import { TermousApiTransport } from '#shared/api'

export class CloudClient extends TermousApiTransport implements CloudGateway {
  private readonly state = new CloudState()
  getStatus = this.state.snapshot
  subscribeStatus = this.state.subscribe
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
  login(generation: string, email: string, password: string) {
    return this.readStatus(this.request('/api/v1/cloud/auth/login', { method: 'POST', body: { generation, email, password }, timeoutMs: 125_000 }))
  }
  logout(generation: string) { return this.readStatus(this.request('/api/v1/cloud/auth/logout', { method: 'POST', body: { generation }, timeoutMs: 125_000 })) }
  async auth(action: CloudAuthAction, input: { generation: string; email?: string; password?: string; token?: string }) {
    await this.request(`/api/v1/cloud/auth/${action}`, { method: 'POST', body: input, timeoutMs: 125_000 })
  }
  devices() { return this.request('/api/v1/cloud/devices', { timeoutMs: 125_000 }).then((value) => decodeCloudList(value, decodeCloudDevice)) }
  sessions() { return this.request('/api/v1/cloud/sessions', { timeoutMs: 125_000 }).then((value) => decodeCloudList(value, decodeCloudSession)) }
  pairing(generation: string) { return this.request('/api/v1/cloud/devices/pairing', { method: 'POST', body: { generation }, timeoutMs: 125_000 }).then(decodeCloudPairing) }
  approve(generation: string, challenge: CloudChallenge, fingerprint: string) { return this.request('/api/v1/cloud/devices/approve', { method: 'POST', body: { generation, challenge, fingerprint }, timeoutMs: 125_000 }).then(decodeCloudApproval) }
  accept(generation: string, trustRoot: string) { return this.readStatus(this.request('/api/v1/cloud/devices/accept', { method: 'POST', body: { generation, trust_root: trustRoot }, timeoutMs: 125_000 })) }
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
