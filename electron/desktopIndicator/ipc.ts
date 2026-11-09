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
  let closed = false
  const own = (event: IpcMainInvokeEvent) => {
    if (closed) throw new Error('desktop_indicator_closed')
    return options.own(event)
  }
  options.ipc.handle('desktop-indicator:state', event => options.state(own(event)))
  options.ipc.handle('desktop-indicator:reclaim', async (event, request: unknown) => {
    const role = own(event)
    const snapshot = options.snapshot()
    if (role !== 'bar' || pending || !snapshot || !isDesktopControlReclaim(request) || request.target.kind !== 'host_desktop'
      || !sameDesktopControl(request, snapshot)) throw new Error('desktop_control_stale')
    pending = true
    const control = snapshot.controls.find(c => c.reference === request.reference)!
    try { await options.reclaim({ instance_id: snapshot.instance_id, target: control.target, reference: control.reference }) }
    // 卸载不取消已经派发的业务请求，但迟到的失败不能再触发退出后的界面提示。
    catch (error) { if (!closed) options.failed(); throw error }
    finally { pending = false }
  })
  return () => {
    if (closed) return
    closed = true
    options.ipc.removeHandler('desktop-indicator:state')
    options.ipc.removeHandler('desktop-indicator:reclaim')
  }
}
