import type { SystemFileClipboardState } from '#common/contracts'

export interface DesktopSystemClipboardState extends SystemFileClipboardState { busy: boolean; dragging?: boolean; notice?: 'prepared' | 'failed' }
interface Entry { state: DesktopSystemClipboardState; listeners: Set<() => void>; owner?: symbol }
const empty: DesktopSystemClipboardState = Object.freeze({ supported: false, enabled: false, files: [], busy: false })
const entries = new Map<string, Entry>()
export const systemClipboardStore = {
  get: (id: string) => entries.get(id)?.state ?? empty,
  subscribe(id: string, listener: () => void) {
    let entry = entries.get(id)
    if (!entry) { entry = { state: empty, listeners: new Set() }; entries.set(id, entry) }
    entry.listeners.add(listener)
    return () => { entry.listeners.delete(listener) }
  },
  update(id: string, patch: Partial<DesktopSystemClipboardState>) {
    const entry = entries.get(id) ?? { state: empty, listeners: new Set() }
    entry.state = { ...entry.state, ...patch }; entries.set(id, entry)
    for (const listener of entry.listeners) listener()
  },
  bind(id: string) {
    const entry = entries.get(id) ?? { state: empty, listeners: new Set() }
    const owner = Symbol()
    entry.owner = owner; entries.set(id, entry)
    return () => {
      if (entry.owner === owner) {
        entry.owner = undefined
        entry.state = empty
        for (const listener of entry.listeners) listener()
        if (!entry.listeners.size) entries.delete(id)
      }
    }
  },
}
