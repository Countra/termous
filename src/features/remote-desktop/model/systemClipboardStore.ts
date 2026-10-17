import type { SystemFileClipboardState } from '#common/contracts'

export interface DesktopSystemClipboardState extends SystemFileClipboardState { busy: boolean; dragging?: boolean; notice?: 'prepared' | 'failed' }
interface Entry { state: DesktopSystemClipboardState; listeners: Set<() => void>; owner?: symbol; prepare?: () => Promise<void> }
const empty: DesktopSystemClipboardState = Object.freeze({ supported: false, enabled: false, files: [], busy: false })
const entries = new Map<string, Entry>()
export const systemClipboardStore = {
  get: (id: string) => entries.get(id)?.state ?? empty,
  subscribe(id: string, listener: () => void) {
    let entry = entries.get(id)
    if (!entry) { entry = { state: empty, listeners: new Set() }; entries.set(id, entry) }
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      if (!entry.owner && !entry.listeners.size && entries.get(id) === entry) entries.delete(id)
    }
  },
  update(id: string, patch: Partial<DesktopSystemClipboardState>) {
    const entry = entries.get(id) ?? { state: empty, listeners: new Set() }
    entry.state = { ...entry.state, ...patch }; entries.set(id, entry)
    for (const listener of entry.listeners) listener()
  },
  async prepare(id: string) {
    const prepare = entries.get(id)?.prepare
    if (!prepare) throw new Error('desktop_not_ready')
    await prepare()
  },
  bind(id: string, prepare?: () => Promise<void>) {
    const entry = entries.get(id) ?? { state: empty, listeners: new Set() }
    const owner = Symbol()
    entry.owner = owner; entry.prepare = prepare; entries.set(id, entry)
    return () => {
      if (entry.owner === owner) {
        entry.owner = undefined
        entry.prepare = undefined
        entry.state = empty
        for (const listener of entry.listeners) listener()
        if (!entry.owner && !entry.listeners.size && entries.get(id) === entry) entries.delete(id)
      }
    }
  },
}
