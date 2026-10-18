import type { Asset, Definition, Diagnostic, ImageTarget, Located, Preview, Run, SaveInput, Script, Snapshot, StartInput, StepResult, Version, WorkflowGateway } from '#entities/desktop-workflow'
import type { DesktopSnapshotMetadata } from '#entities/remote-desktop'
import { TermousApiError, TermousApiTransport } from '#shared/api'

const scripts = '/api/v1/desktop-workflows'
const runs = '/api/v1/desktop-workflow-runs'
const previews = '/api/v1/desktop-workflow-previews'
const assets = '/api/v1/desktop-workflow-assets'
const key = encodeURIComponent

export class WorkflowClient extends TermousApiTransport implements WorkflowGateway {
  list(signal?: AbortSignal) { return this.request<Script[]>(scripts, { signal }) }
  get(id: string) { return this.request<{ script: Script; version: Version }>(`${scripts}/${key(id)}`) }
  save(id: string | undefined, input: SaveInput) { return this.request<Script>(id ? `${scripts}/${key(id)}` : scripts, { method: id ? 'PUT' : 'POST', body: input }) }
  remove(id: string, revision: number) { return this.request<void>(`${scripts}/${key(id)}?revision=${revision}`, { method: 'DELETE' }) }
  versions(id: string) { return this.request<Version[]>(`${scripts}/${key(id)}/versions`) }
  restore(id: string, version: number, expectedRevision: number) { return this.request<Script>(`${scripts}/${key(id)}/restore`, { method: 'POST', body: { version, expected_revision: expectedRevision } }) }
  validate(definition: Definition) { return this.request<Diagnostic[]>(`${scripts}/validate`, { method: 'POST', body: definition }) }
  upload(file: Blob) { const body = new FormData(); body.append('file', file, 'template.png'); return this.request<Asset>(assets, { method: 'POST', body }) }
  asset(id: string, signal?: AbortSignal) { return this.requestBlob(`${assets}/${key(id)}`, { signal }) }
  openPreview(session: string, generation: number) { return this.request<Preview>(previews, { method: 'POST', body: { session_id: session, connection_generation: generation }, timeoutMs: 15_000 }) }
  closePreview(id: string) { return this.request<void>(`${previews}/${key(id)}`, { method: 'DELETE' }) }
  async capture(id: string, signal?: AbortSignal): Promise<Snapshot> {
    let metadata: DesktopSnapshotMetadata | undefined
    const blob = await this.requestBlob(`${previews}/${key(id)}/capture`, { method: 'POST', signal, onHeaders(headers) {
      const raw = headers.get('X-Termous-Desktop-Snapshot')
      if (raw) metadata = JSON.parse(raw) as DesktopSnapshotMetadata
    } })
    if (!metadata?.width || !metadata.height || blob.type !== 'image/png') throw new TermousApiError('截图响应无效', 'desktop_invalid_response', 0)
    return { metadata, blob }
  }
  async match(id: string, target: ImageTarget, signal?: AbortSignal): Promise<Located> {
    let metadata: DesktopSnapshotMetadata | undefined
    let result: Located['result'] | undefined
    const image = await this.requestBlob(`${previews}/${key(id)}/match`, { method: 'POST', body: target, signal, timeoutMs: 20_000, onHeaders(headers) {
      const snapshot = headers.get('X-Termous-Desktop-Snapshot'); const match = headers.get('X-Termous-Desktop-Match')
      if (snapshot) metadata = JSON.parse(snapshot) as DesktopSnapshotMetadata
      if (match) result = JSON.parse(match) as Located['result']
    } })
    if (!metadata || !result || image.type !== 'image/png') throw new TermousApiError('定位响应无效', 'desktop_invalid_response', 0)
    return { capture: { metadata }, result, image }
  }
  listRuns(signal?: AbortSignal) { return this.request<Run[]>(runs, { signal }) }
  run(id: string, signal?: AbortSignal) { return this.request<{ run: Run; steps: StepResult[] }>(`${runs}/${key(id)}`, { signal }) }
  start(input: StartInput) { return this.request<Run>(runs, { method: 'POST', body: input }) }
  control(id: string, requestID: string, action: 'pause' | 'resume' | 'step' | 'cancel') { return this.request<Run>(`${runs}/${key(id)}/control`, { method: 'POST', body: { request_id: requestID, action } }) }
  eventsURL() { return this.websocketUrl(`${scripts}/events`) }
}
