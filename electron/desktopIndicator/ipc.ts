import type { IpcMainInvokeEvent } from 'electron'
import { isDesktopControlReclaim, sameDesktopControl, type DesktopControlReclaim, type DesktopControlSnapshot, type DesktopIndicatorState } from '#common/contracts'

interface Options {
  ipc: { handle(channel: string, listener: (event: IpcMainInvokeEvent, request?: unknown) => unknown): void; removeHandler(channel: string): void }
  own(event: IpcMainInvokeEvent): DesktopIndicatorState['role']
  state(role: DesktopIndicatorState['role']): DesktopIndicatorState
  snapshot(): DesktopControlSnapshot | null
  reclaim(request: DesktopControlReclaim): Promise<void>
  failed(): void
}
export function installIndicatorIPC(options: Options) {
  let pending = false
  options.ipc.handle('desktop-indicator:state', event => options.state(options.own(event)))
  options.ipc.handle('desktop-indicator:reclaim', async (event, request: unknown) => {
    const role = options.own(event)
    const snapshot = options.snapshot()
    if (role !== 'bar' || pending || !snapshot || !isDesktopControlReclaim(request) || request.target.kind !== 'host_desktop'
      || !sameDesktopControl(request, snapshot)) throw new Error('desktop_control_stale')
    pending = true
    const control = snapshot.controls.find(c => c.reference === request.reference)!
    try { await options.reclaim({ instance_id: snapshot.instance_id, target: control.target, reference: control.reference }) }
    catch (error) { options.failed(); throw error }
    finally { pending = false }
  })
  return () => { options.ipc.removeHandler('desktop-indicator:state'); options.ipc.removeHandler('desktop-indicator:reclaim') }
}
