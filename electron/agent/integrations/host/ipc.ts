import { type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { isRecord } from '../../contracts/validation.ts'
import type { IntegrationHostSupervisor } from './supervisor.ts'
import { integrationDiagnostic } from '../diagnostics.ts'
import type { AgentIntegrationSource } from '#common/agent-integrations'

export function registerIntegrationIPC(options: {
  ipcMain: IpcMain
  host: IntegrationHostSupervisor
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  source(id: string): Promise<AgentIntegrationSource>
}) {
  const pending = new Map<string, AbortController>()
  options.ipcMain.handle('agent-integrations:cancel', (event, id: unknown) => {
    if (options.isTrustedSender(event) && typeof id === 'string') pending.get(`${event.sender.id}:${id}`)?.abort()
  })
  options.ipcMain.handle('agent-integrations:status', event => {
    if (!options.isTrustedSender(event)) throw new Error('INTEGRATION_IPC_NOT_ALLOWED')
    return options.host.status()
  })
  const execute = (operation: 'test' | 'login' | 'reconnect') => async (event: IpcMainInvokeEvent, request: unknown) => {
    if (!options.isTrustedSender(event) || !isRecord(request) || typeof request.source !== 'string' || typeof request.request_id !== 'string'
      || request.request_id.length > 128 || !Number.isSafeInteger(request.revision)) throw new Error('INTEGRATION_IPC_NOT_ALLOWED')
    const key = `${event.sender.id}:${request.request_id}`
    if (pending.has(key) || pending.size >= 16) throw new Error('INTEGRATION_QUEUE_FULL')
    const abort = new AbortController()
    const destroyed = () => abort.abort()
    pending.set(key, abort)
    event.sender.once('destroyed', destroyed)
    try {
      const source = await options.source(request.source)
      if (source.revision !== request.revision || source.kind !== 'mcp') throw new Error('INTEGRATION_CONFIG_CHANGED')
      if (operation === 'login' && source.mcp?.auth !== 'oauth') throw new Error('INTEGRATION_CONFIG_CHANGED')
      abort.signal.throwIfAborted()
      return operation === 'test' ? await options.host.test(source.id, source.revision, abort.signal, typeof request.candidate_id === 'string' ? request.candidate_id : undefined) : await options.host[operation](source.id, source.revision, abort.signal)
    } catch (error) { return { failure: integrationDiagnostic(error) } } finally { pending.delete(key); event.sender.removeListener('destroyed', destroyed) }
  }
  const owners = new Map<number, Set<string>>()
  options.ipcMain.handle('agent-integrations:prepare', async (event, session: unknown) => {
    if (!options.isTrustedSender(event) || typeof session !== 'string' || session.length > 128 || !session) throw new Error('INTEGRATION_IPC_NOT_ALLOWED')
    let current = owners.get(event.sender.id)
    if (!current) {
      current = new Set(); owners.set(event.sender.id, current)
      event.sender.once('destroyed', () => { for (const owner of owners.get(event.sender.id) ?? []) options.host.release(owner); owners.delete(event.sender.id) })
    }
    const owner = `prepare:${event.sender.id}:${session}`
    if (!current.has(owner) && current.size >= 16) throw new Error('INTEGRATION_PREPARATION_CAPACITY')
    current.add(owner)
    try { return await options.host.prepare(session, owner) }
    finally { if (!owners.get(event.sender.id)?.has(owner)) options.host.release(owner) }
  })
  options.ipcMain.handle('agent-integrations:release-preparation', (event, session: unknown) => {
    if (!options.isTrustedSender(event) || typeof session !== 'string' || session.length > 128) return
    const owner = `prepare:${event.sender.id}:${session}`
    if (owners.get(event.sender.id)?.delete(owner)) options.host.release(owner)
  })
  options.ipcMain.handle('agent-integrations:test', execute('test'))
  options.ipcMain.handle('agent-integrations:login', execute('login'))
  options.ipcMain.handle('agent-integrations:reconnect', execute('reconnect'))
  return () => {
    for (const current of owners.values()) for (const owner of current) options.host.release(owner)
    owners.clear()
    options.ipcMain.removeHandler('agent-integrations:prepare')
    options.ipcMain.removeHandler('agent-integrations:release-preparation')
    for (const controller of pending.values()) controller.abort()
    options.ipcMain.removeHandler('agent-integrations:test')
    options.ipcMain.removeHandler('agent-integrations:login')
    options.ipcMain.removeHandler('agent-integrations:cancel')
    options.ipcMain.removeHandler('agent-integrations:reconnect')
    options.ipcMain.removeHandler('agent-integrations:status')
  }
}
