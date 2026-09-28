import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { desktopSettingsModules, localSettingsDefinitions, settingsIPCChannels, type DesktopSettingsModule, type SettingsEvent, type SettingsIPCResult, type SettingsSnapshot } from '#common/contracts'

export interface DesktopSettingsAdapter {
  read(): Promise<Pick<SettingsSnapshot, 'value' | 'state'>> | Pick<SettingsSnapshot, 'value' | 'state'>
  apply(patch: Record<string, unknown>): Promise<void> | void
}

// 模块串行队列覆盖读取、版本检查和落盘，不把不同模块串成一个全局等待队列。
export class DesktopSettingsRuntime {
  readonly instanceId = randomUUID()
  private snapshots = new Map<DesktopSettingsModule, SettingsSnapshot>()
  private queues = new Map<DesktopSettingsModule, Promise<unknown>>()
  private readonly adapters: Record<DesktopSettingsModule, DesktopSettingsAdapter>
  private readonly changed: (event: SettingsEvent) => void
  constructor(adapters: Record<DesktopSettingsModule, DesktopSettingsAdapter>, changed: (event: SettingsEvent) => void) { this.adapters = adapters; this.changed = changed }

  private async read(id: DesktopSettingsModule) {
    const next = await this.adapters[id].read()
    const previous = this.snapshots.get(id)
    const changed = previous && JSON.stringify(previous.value) !== JSON.stringify(next.value)
    const snapshot: SettingsSnapshot = { id, schema_version: localSettingsDefinitions[id].schema_version, revision: previous ? previous.revision + (changed ? 1 : 0) : 1, ...next }
    this.snapshots.set(id, structuredClone(snapshot))
    if (changed) this.changed({ instance_id: this.instanceId, type: 'changed', module: id, revision: snapshot.revision })
    return snapshot
  }

  request(module: unknown, request?: unknown): Promise<SettingsIPCResult> {
    if (typeof module !== 'string' || !desktopSettingsModules.includes(module as DesktopSettingsModule)) return Promise.resolve({ ok: false, code: 'SETTINGS_UNSUPPORTED_MODULE' })
    const id = module as DesktopSettingsModule
    const run = async (): Promise<SettingsIPCResult> => {
      try {
        if (request !== undefined) {
          const input = record(request)
          if (Object.keys(input).some((key) => !['expected_revision', 'patch'].includes(key)) || !Number.isSafeInteger(input.expected_revision) || Number(input.expected_revision) < 1) throw new Error('SETTINGS_INVALID_REQUEST')
          const patch = record(input.patch)
          if (!Object.keys(patch).length || JSON.stringify(patch).length > 4096) throw new Error('SETTINGS_INVALID_REQUEST')
          const current = await this.read(id)
          if (current.revision !== input.expected_revision) throw new Error('SETTINGS_REVISION_CONFLICT')
          if (current.state.status === 'unavailable') throw new Error('SETTINGS_UNAVAILABLE')
          await this.adapters[id].apply(patch)
        }
        return { ok: true, snapshot: await this.read(id) }
      } catch (error) {
        // IPC 拒绝会丢失自定义属性；用受控错误码保留冲突及系统回读错误，不回传原始堆栈。
        const message = error instanceof Error ? error.message : ''
        const code = /^(SETTINGS_[A-Z_]+|LOGIN_ITEM_[A-Z_]+)$/.test(message) ? message : 'SETTINGS_OPERATION_FAILED'
        return { ok: false, code }
      }
    }
    const pending = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(run)
    this.queues.set(id, pending)
    void pending.finally(() => { if (this.queues.get(id) === pending) this.queues.delete(id) }).catch(() => undefined)
    return pending
  }
}

export function registerSettingsIPC(options: { ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>; runtime: DesktopSettingsRuntime; trusted(event: IpcMainInvokeEvent): boolean }) {
  for (const [channel, write] of [[settingsIPCChannels.get, false], [settingsIPCChannels.update, true]] as const) {
    options.ipcMain.handle(channel, (event, id: unknown, request: unknown) => {
      if (!options.trusted(event)) throw new Error('SETTINGS_IPC_NOT_ALLOWED')
      if (write && request === undefined) return { ok: false, code: 'SETTINGS_INVALID_REQUEST' }
      return options.runtime.request(id, write ? request : undefined)
    })
  }
  return () => { options.ipcMain.removeHandler(settingsIPCChannels.get); options.ipcMain.removeHandler(settingsIPCChannels.update) }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SETTINGS_INVALID_REQUEST')
  return value as Record<string, unknown>
}
