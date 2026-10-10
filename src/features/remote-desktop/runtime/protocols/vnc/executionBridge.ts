import { serveVncExecution, type ExecutionChannel, type VncDesktopExecution } from '@termous/remote-protocol/vnc'
import type { DesktopExecutionConnection } from '../../core/viewerContracts.ts'

export type VncExecutionConnection = DesktopExecutionConnection

export async function connectVncExecution(connection: VncExecutionConnection, execution: VncDesktopExecution, signal: AbortSignal, failed: () => void, readOnly: boolean): Promise<() => void> {
  const ticket = await connection.connect(readOnly)
  signal.throwIfAborted()
  const ws = new WebSocket(ticket.url, ['binary'])
  return serveVncExecution(ws as unknown as ExecutionChannel, execution, signal, failed, () => ws.send(JSON.stringify({ ticket: ticket.ticket })))
}