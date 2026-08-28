import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type {
  AgentRuntimeRunRef,
  AgentRuntimeStatus,
  AgentRuntimeSteerRequest,
} from '#common/contracts'
import type { AgentSupervisor } from './supervisor.ts'

export const agentRuntimeIPCChannels = {
  getStatus: 'agent-runtime:get-status',
  start: 'agent-runtime:start',
  stop: 'agent-runtime:stop',
  steer: 'agent-runtime:steer',
  status: 'agent-runtime:status',
} as const

export interface AgentRuntimeIPCOptions {
  ipcMain: IpcMain
  supervisor: Pick<
    AgentSupervisor,
    'getStatus' | 'startRun' | 'stopRun' | 'steerRun' | 'subscribe'
  >
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  sendStatus: (status: AgentRuntimeStatus) => void
}

export function registerAgentRuntimeIPC(options: AgentRuntimeIPCOptions) {
  const requireTrustedSender = (event: IpcMainInvokeEvent) => {
    if (!options.isTrustedSender(event)) {
      throw new Error('AGENT_RUNTIME_IPC_NOT_ALLOWED')
    }
  }
  options.ipcMain.handle(agentRuntimeIPCChannels.getStatus, (event) => {
    requireTrustedSender(event)
    return options.supervisor.getStatus()
  })
  options.ipcMain.handle(agentRuntimeIPCChannels.start, (event, request: unknown) => {
    requireTrustedSender(event)
    return options.supervisor.startRun(request as AgentRuntimeRunRef)
  })
  options.ipcMain.handle(agentRuntimeIPCChannels.stop, (event, request: unknown) => {
    requireTrustedSender(event)
    return options.supervisor.stopRun(request as AgentRuntimeRunRef)
  })
  options.ipcMain.handle(agentRuntimeIPCChannels.steer, (event, request: unknown) => {
    requireTrustedSender(event)
    return options.supervisor.steerRun(request as AgentRuntimeSteerRequest)
  })
  const unsubscribe = options.supervisor.subscribe(options.sendStatus)
  return () => {
    unsubscribe()
    options.ipcMain.removeHandler(agentRuntimeIPCChannels.getStatus)
    options.ipcMain.removeHandler(agentRuntimeIPCChannels.start)
    options.ipcMain.removeHandler(agentRuntimeIPCChannels.stop)
    options.ipcMain.removeHandler(agentRuntimeIPCChannels.steer)
  }
}

