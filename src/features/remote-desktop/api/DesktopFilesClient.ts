import type { DesktopFilesState, DesktopExchange, DesktopFileEntry, DesktopFileClipboard, DesktopClipboardQuery, DesktopDirectoryMapping } from '#entities/remote-desktop'
import type { LocalFileGrant, TransferTask, OverwritePolicy } from '#entities/file'
import { TermousApiTransport } from '#shared/api'

// 文件正文复用 Core 任务；请求取消或超时后不自动重放写操作。
export class DesktopFilesClient extends TermousApiTransport {
  describe(id: string, generation: number, signal?: AbortSignal) {
    return this.request<DesktopFilesState>(`${this.session(id)}/files?generation=${generation}`, { signal })
  }
  mapping(id: string, generation: number, action: 'add' | 'remove' | 'pause' | 'resume', value: string) {
    return this.request<DesktopDirectoryMapping>(`${this.session(id)}/file-mappings`, { method: 'POST', body: { generation, action, ...(action === 'add' ? { grant_id: value } : { mapping_id: value }) } })
  }
  async rememberMapping(id: string, generation: number, mappingId: string, remember: boolean) {
    const current = await this.request<{ revision: number }>('/api/v1/settings/desktop_files')
    return this.request('/api/v1/settings/desktop_files', { method: 'PATCH', body: { expected_revision: current.revision, patch: { session_id: id, generation, mapping_id: mappingId, remember } } })
  }
  createExchange(id: string, generation: number, operationId: string) {
    return this.request<DesktopExchange>(`${this.session(id)}/file-exchanges`, { method: 'POST', body: { generation, operation_id: operationId } })
  }
  rebindExchange(id: string, generation: number, exchange: DesktopExchange) {
    return this.request<DesktopExchange>(`${this.session(id)}/file-exchanges`, { method: 'POST', body: { generation, exchange_id: exchange.id, resource_generation: exchange.resource_generation } })
  }
  entries(exchange: Pick<DesktopExchange, 'id' | 'resource_generation'>, path: string, retained = false, signal?: AbortSignal) {
    const query = new URLSearchParams({ generation: String(exchange.resource_generation), path, retained: String(retained) })
    return this.request<DesktopFileEntry[]>(`${this.exchange(exchange.id)}/entries?${query}`, { signal })
  }
  mutate(exchange: DesktopExchange, action: 'mkdir' | 'rename' | 'remove', path: string, version = '', target = '') {
    return this.request<void>(`${this.exchange(exchange.id)}/entries`, { method: 'POST', body: { generation: exchange.resource_generation, action, path, version, target } })
  }
  transfer(exchange: DesktopExchange, action: 'upload' | 'download' | 'claim', grantId: string, paths: string[], target: string, overwrite: OverwritePolicy) {
    return this.request<TransferTask>(`${this.exchange(exchange.id)}/transfers`, { method: 'POST', body: { generation: exchange.resource_generation, action, grant_id: grantId, paths, target, overwrite } })
  }
  retained(signal?: AbortSignal) { return this.request<DesktopExchange[]>('/api/v1/desktop-file-exchanges', { signal }) }
  clean(exchange: DesktopExchange) { return this.request<void>(`${this.exchange(exchange.id)}?generation=${exchange.resource_generation}`, { method: 'DELETE' }) }
  grant(paths: string[]) { return this.request<LocalFileGrant>('/api/v1/local-file-grants', { method: 'POST', body: { source: 'picker', paths } }) }
  releaseGrant(id: string) { return this.request<void>(`/api/v1/local-file-grants/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  tasks(signal?: AbortSignal) { return this.request<TransferTask[]>('/api/v1/transfers', { signal }) }
  cancelTask(id: string) { return this.request<void>(`/api/v1/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  retryTask(id: string) { return this.request<TransferTask>(`/api/v1/transfers/${encodeURIComponent(id)}/retry`, { method: 'POST' }) }
  clipboard(id: string, query: DesktopClipboardQuery, signal?: AbortSignal) {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
    return this.request<DesktopFileClipboard>(`${this.session(id)}/file-clipboard?${params}`, { signal })
  }
  requestClipboard(id: string, query: DesktopClipboardQuery, action: 'list' | 'revoke') {
    return this.request<NonNullable<DesktopFileClipboard['operation']>>(`${this.session(id)}/file-clipboard`, { method: 'POST', body: { ...query, action } })
  }
  transferClipboard(id: string, query: DesktopClipboardQuery, action: 'publish' | 'receive', grantId: string, indexes: number[], overwrite: OverwritePolicy) {
    return this.request<TransferTask>(`${this.session(id)}/file-clipboard/transfers`, { method: 'POST', body: { ...query, action, grant_id: grantId, indexes, overwrite } })
  }
  private session(id: string) { return `/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}` }
  private exchange(id: string) { return `/api/v1/desktop-file-exchanges/${encodeURIComponent(id)}` }
}

export type DesktopFilesGateway = Pick<DesktopFilesClient, 'describe' | 'mapping' | 'rememberMapping' | 'createExchange' | 'rebindExchange' | 'entries' | 'mutate' | 'transfer' | 'retained' | 'clean' | 'grant' | 'releaseGrant' | 'tasks' | 'cancelTask' | 'retryTask' | 'clipboard' | 'requestClipboard' | 'transferClipboard'>
