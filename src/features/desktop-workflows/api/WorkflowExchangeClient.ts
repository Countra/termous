import type { WorkflowExchangeGateway, WorkflowImportCommit, WorkflowImportReceipt, WorkflowImportView } from '#entities/desktop-workflow'
import { TermousApiTransport } from '#shared/api'

const imports = '/api/v1/desktop-workflows/imports'
export class WorkflowExchangeClient extends TermousApiTransport implements WorkflowExchangeGateway {
  inspect(id: string, signal?: AbortSignal) { return this.request<WorkflowImportView>(`${imports}/${encodeURIComponent(id)}`, { signal }) }
  commit(id: string, input: WorkflowImportCommit, signal?: AbortSignal) {
    return this.request<WorkflowImportReceipt>(`${imports}/${encodeURIComponent(id)}/commit`, { method: 'POST', body: input, signal, timeoutMs: 300000 })
  }
  release(id: string) { return this.request<void>(`${imports}/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  asset(id: string, hash: string, signal?: AbortSignal) { return this.requestBlob(`${imports}/${encodeURIComponent(id)}/assets/${encodeURIComponent(hash)}`, { signal }) }
}
