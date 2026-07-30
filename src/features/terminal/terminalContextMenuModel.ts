import type { TerminalContextSnapshot } from './terminalContextTarget.ts'

export type TerminalContextMenuActionKey =
  | 'reconnect'
  | 'open_link'
  | 'copy_link'
  | 'open_path'
  | 'copy_path'
  | 'copy_selection'
  | 'find_selection'
  | 'paste'
  | 'select_all'
  | 'find'

export type TerminalContextMenuItem =
  | {
    type: 'action'
    key: TerminalContextMenuActionKey
    disabled: boolean
  }
  | {
    type: 'separator'
    key: string
  }

export interface TerminalContextMenuOptions {
  canOpenPath?: boolean
  showOpenPath?: boolean
  canReconnect?: boolean
  reconnectDisabled?: boolean
}

export function buildTerminalContextMenu(
  snapshot: TerminalContextSnapshot,
  options: TerminalContextMenuOptions = {},
): TerminalContextMenuItem[] {
  const items: TerminalContextMenuItem[] = []

  if (snapshot.disconnected && options.canReconnect !== false) {
    items.push(action('reconnect', options.reconnectDisabled), separator('after-reconnect'))
  }

  if (snapshot.target?.kind === 'url') {
    items.push(
      action('open_link'),
      action('copy_link'),
      separator('after-link'),
      action('paste', !snapshot.writable),
      action('select_all'),
      action('find'),
    )
    return items
  }

  if (snapshot.target?.kind === 'path') {
    if (options.showOpenPath !== false && !snapshot.target.copyOnly) {
      items.push(action('open_path', options.canOpenPath === false))
    }
    items.push(
      action('copy_path'),
      separator('after-path'),
      action('paste', !snapshot.writable),
      action('select_all'),
      action('find'),
    )
    return items
  }

  if (snapshot.selectionText) {
    items.push(
      action('copy_selection'),
      action(snapshot.searchSeed ? 'find_selection' : 'find'),
      action('paste', !snapshot.writable),
      separator('after-selection'),
      action('select_all'),
    )
    return items
  }

  items.push(
    action('paste', !snapshot.writable),
    action('select_all'),
    action('find'),
  )
  return items
}

function action(key: TerminalContextMenuActionKey, disabled = false): TerminalContextMenuItem {
  return { type: 'action', key, disabled }
}

function separator(key: string): TerminalContextMenuItem {
  return { type: 'separator', key }
}
