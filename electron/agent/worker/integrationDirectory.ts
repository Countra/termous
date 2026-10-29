import { createHash } from 'node:crypto'
import { integrationErrorCode, type IntegrationDirectory } from '../contracts/integrationIPC.ts'
import type { WorkerIntegrationProxy } from './integrationProxy.ts'

// 外部宿主失联时撤下其声明，但内置通道继续工作；按需查询入口保留明确故障状态。
export async function readIntegrationDirectory(proxy: WorkerIntegrationProxy, signal?: AbortSignal, fingerprint?: string): Promise<IntegrationDirectory | {unchanged:true}> {
  try { return await proxy.request({action:'directory',fingerprint},signal) }
  catch(error) {
    signal?.throwIfAborted()
    const status=integrationErrorCode(error)
    const next=createHash('sha256').update(status).digest('hex')
    return next===fingerprint ? {unchanged:true} : {sources:[],tools:[],status,fingerprint:next}
  }
}
