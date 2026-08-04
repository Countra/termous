import { createShortcutChord } from './chords.ts'
import {
  SHORTCUT_ACTION_IDS,
  type ShortcutActionGroup,
  type ShortcutActionDefinition,
  type ShortcutActionId,
  type ShortcutModifier,
  type ShortcutScope,
} from './types.ts'

const chord = (
  code: string,
  key: string,
  modifiers: readonly ShortcutModifier[] = [],
) => createShortcutChord(code, key, modifiers)

const action = (
  id: ShortcutActionId,
  group: ShortcutActionGroup,
  scope: ShortcutScope,
  defaultBindings: readonly ReturnType<typeof chord>[],
  options: Partial<Pick<ShortcutActionDefinition, 'allowInEditable' | 'allowRepeat'>> = {},
): ShortcutActionDefinition => Object.freeze({
  id,
  group,
  scope,
  defaultBindings: Object.freeze(defaultBindings.map((binding) => Object.freeze({
    ...binding,
    modifiers: Object.freeze([...binding.modifiers]) as unknown as ShortcutModifier[],
  }))),
  allowInEditable: options.allowInEditable ?? false,
  allowRepeat: options.allowRepeat ?? false,
  conflictDomains: Object.freeze(conflictDomainsForScope(scope)),
  customizable: true as const,
})

export const SHORTCUT_ACTIONS: readonly ShortcutActionDefinition[] = Object.freeze([
  action('app.host_launcher.open', 'global', 'app.global', [
    chord('KeyH', 'H', ['control', 'shift']),
  ], { allowInEditable: true }),
  action('terminal.copy_selection', 'terminal', 'terminal.selection', [
    chord('KeyC', 'c', ['primary']),
    chord('KeyC', 'C', ['primary', 'shift']),
  ]),
  action('terminal.paste', 'terminal', 'terminal.writable', [
    chord('KeyV', 'v', ['primary']),
    chord('KeyV', 'V', ['primary', 'shift']),
  ]),
  action('terminal.completion.previous', 'completion', 'terminal.completion.visible', [
    chord('ArrowUp', 'ArrowUp'),
  ], { allowRepeat: true }),
  action('terminal.completion.next', 'completion', 'terminal.completion.visible', [
    chord('ArrowDown', 'ArrowDown'),
  ], { allowRepeat: true }),
  action('terminal.completion.accept', 'completion', 'terminal.completion.visible', [
    chord('Enter', 'Enter'),
  ]),
  action('terminal.search.open', 'terminal', 'terminal.active', []),
  action('terminal.select_all', 'terminal', 'terminal.active', []),
  action('terminal.session.reconnect', 'terminal', 'terminal.disconnected', []),
  action('files.select_all', 'files', 'files.standalone', [
    chord('KeyA', 'a', ['primary']),
  ]),
  action('files.open_focused', 'files', 'files.list', [
    chord('Enter', 'Enter'),
  ]),
  action('files.rename_focused', 'files', 'files.standalone', [
    chord('F2', 'F2'),
  ]),
  action('files.delete_selection', 'files', 'files.standalone', [
    chord('Delete', 'Delete'),
  ]),
  action('files.editor.save', 'editor', 'files.editor', [
    chord('KeyS', 's', ['primary']),
  ], { allowInEditable: true }),
])

function conflictDomainsForScope(scope: ShortcutScope) {
  if (scope === 'app.global') return ['application'] as const
  if (scope.startsWith('terminal.')) return ['terminal'] as const
  if (scope === 'files.editor') return ['editor'] as const
  return ['files'] as const
}

const shortcutActionsById = new Map(
  SHORTCUT_ACTIONS.map((definition) => [definition.id, definition]),
)

export function isShortcutActionId(value: string): value is ShortcutActionId {
  return (SHORTCUT_ACTION_IDS as readonly string[]).includes(value)
}

export function getShortcutAction(actionId: ShortcutActionId) {
  const definition = shortcutActionsById.get(actionId)
  if (!definition) {
    throw new RangeError(`Unknown shortcut action: ${actionId}`)
  }
  return definition
}

export { SHORTCUT_ACTION_IDS }
