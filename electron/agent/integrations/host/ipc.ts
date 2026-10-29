import { dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { isRecord } from '../../contracts/validation.ts'
import type { IntegrationHostSupervisor } from './supervisor.ts'
import type { AgentIntegrationSource } from '#common/agent-integrations'

export function registerIntegrationIPC(options: {
  ipcMain: IpcMain
  host: IntegrationHostSupervisor
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  source(id: string): Promise<AgentIntegrationSource>
  english(): boolean
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
      if (operation !== 'login' && source.mcp?.transport === 'stdio') {
        const en = options.english()
        const answer = await dialog.showMessageBox({ type: 'question', title: en ? 'Start MCP server' : '启动 MCP 服务',
          message: source.name, detail: `${source.mcp.command}\n${JSON.stringify(source.mcp.args ?? [])}\n${source.mcp.cwd ?? ''}`,
          buttons: en ? ['Cancel', 'Start'] : ['取消', '启动'], defaultId: 0, cancelId: 0, noLink: true })
        if (answer.response !== 1) throw new Error('INTEGRATION_START_CANCELLED')
      }
      abort.signal.throwIfAborted()
      return await options.host[operation](source.id, source.revision, abort.signal)
    } finally { pending.delete(key); event.sender.removeListener('destroyed', destroyed) }
  }
  options.ipcMain.handle('agent-integrations:test', execute('test'))
  options.ipcMain.handle('agent-integrations:login', execute('login'))
  options.ipcMain.handle('agent-integrations:reconnect', execute('reconnect'))
  return () => {
    for (const controller of pending.values()) controller.abort()
    options.ipcMain.removeHandler('agent-integrations:test')
    options.ipcMain.removeHandler('agent-integrations:login')
    options.ipcMain.removeHandler('agent-integrations:cancel')
    options.ipcMain.removeHandler('agent-integrations:reconnect')
    options.ipcMain.removeHandler('agent-integrations:status')
  }
}
