import type { ShortcutActionId } from '#features/shortcuts'
import type { TerminalContextMenuActionKey } from './terminalContextMenuModel.ts'

export function terminalContextMenuShortcutAction(
  action: TerminalContextMenuActionKey,
): ShortcutActionId | null {
  switch (action) {
    case 'reconnect':
      return 'terminal.session.reconnect'
    case 'copy_selection':
      return 'terminal.copy_selection'
    case 'find_selection':
    case 'find':
      return 'terminal.search.open'
    case 'paste':
      return 'terminal.paste'
    case 'select_all':
      return 'terminal.select_all'
    default:
      return null
  }
}
