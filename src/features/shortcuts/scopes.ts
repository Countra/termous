import type { ShortcutScope } from './types.ts'

const terminalScopeOverlaps: Readonly<Record<string, readonly ShortcutScope[]>> = {
  'terminal.selection': [
    'terminal.writable',
    'terminal.completion.visible',
    'terminal.active',
    'terminal.disconnected',
  ],
  'terminal.writable': [
    'terminal.selection',
    'terminal.completion.visible',
    'terminal.active',
  ],
  'terminal.completion.visible': [
    'terminal.selection',
    'terminal.writable',
    'terminal.active',
  ],
  'terminal.active': [
    'terminal.selection',
    'terminal.writable',
    'terminal.completion.visible',
    'terminal.disconnected',
  ],
  'terminal.disconnected': [
    'terminal.selection',
    'terminal.active',
  ],
}

export function shortcutScopesOverlap(
  first: ShortcutScope,
  second: ShortcutScope,
) {
  if (first === second || first === 'app.global' || second === 'app.global') {
    return true
  }
  if (terminalScopeOverlaps[first]?.includes(second)) {
    return true
  }
  return (first === 'files.standalone' && second === 'files.list')
    || (first === 'files.list' && second === 'files.standalone')
}

export function shortcutScopePriority(scope: ShortcutScope) {
  switch (scope) {
    case 'terminal.completion.visible':
      return 500
    case 'terminal.selection':
    case 'files.editor':
      return 400
    case 'terminal.writable':
    case 'terminal.disconnected':
    case 'files.standalone':
      return 300
    case 'terminal.active':
    case 'files.list':
      return 200
    case 'app.global':
      return 100
  }
}
