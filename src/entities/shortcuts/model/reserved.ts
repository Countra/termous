import {
  resolvePrimaryModifier,
  resolveShortcutChord,
  shortcutChordsEqual,
} from './chords.ts'
import { getShortcutAction } from './registry.ts'
import type {
  ShortcutActionId,
  ShortcutChord,
  ShortcutModifier,
  ShortcutPlatform,
  ShortcutReservation,
  ShortcutReservationId,
  ShortcutScope,
} from './types.ts'

const ariaNavigationCodes = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
])

const codeEditorPlainCodes = new Set([
  ...ariaNavigationCodes,
  'Backspace',
  'Delete',
  'Enter',
  'NumpadEnter',
])

export function getShortcutReservation(
  actionId: ShortcutActionId,
  chord: ShortcutChord,
  platform: ShortcutPlatform,
): ShortcutReservation | null {
  const action = getShortcutAction(actionId)
  const resolved = resolveShortcutChord(chord, platform)
  const reserve = (id: ShortcutReservationId): ShortcutReservation => ({
    id,
    chord: resolved,
    actionId,
    scope: action.scope,
  })

  if (resolved.code === 'Tab') return reserve('focus_traversal')
  if (resolved.code === 'Escape') return reserve('dismiss')
  if (resolved.code === 'ContextMenu') return reserve('context_menu')
  if (matches(resolved, 'F10', ['shift'])) return reserve('context_menu')
  if (
    matches(resolved, 'KeyF', ['control', 'alt', 'shift'])
  ) {
    return reserve('diagnostics')
  }

  if (action.defaultBindings.some((binding) => (
    shortcutChordsEqual(binding, chord, platform)
  ))) {
    return null
  }

  if (isTerminalScope(action.scope) || action.scope === 'app.global') {
    if (
      matches(resolved, 'Enter', [])
      || matches(resolved, 'Enter', ['shift'])
      || matches(resolved, 'NumpadEnter', [])
      || matches(resolved, 'NumpadEnter', ['shift'])
    ) {
      return reserve('terminal_search')
    }
    if (matches(resolved, 'KeyC', ['control'])) {
      return reserve('terminal_interrupt')
    }
  }

  if (
    (action.scope === 'files.list' || action.scope === 'files.standalone')
    && matches(resolved, 'Space', [])
  ) {
    return reserve('file_selection')
  }

  if (
    (ariaNavigationCodes.has(resolved.code) || resolved.code === 'Enter')
    && hasOnlyOptionalShift(resolved)
  ) {
    return reserve('aria_navigation')
  }

  if (
    (action.scope === 'files.editor' || action.scope === 'app.global')
    && isCodeEditorBinding(resolved, platform)
  ) {
    return reserve('code_editor')
  }
  return null
}

export const findShortcutReservation = getShortcutReservation

function isTerminalScope(scope: ShortcutScope) {
  return scope.startsWith('terminal.')
}

function matches(
  chord: ShortcutChord,
  code: string,
  modifiers: readonly Exclude<ShortcutModifier, 'primary'>[],
) {
  return chord.code === code
    && chord.modifiers.length === modifiers.length
    && chord.modifiers.every((modifier, index) => modifier === modifiers[index])
}

function hasOnlyOptionalShift(chord: ShortcutChord) {
  return chord.modifiers.length === 0
    || (chord.modifiers.length === 1 && chord.modifiers[0] === 'shift')
}

function isCodeEditorBinding(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
) {
  if (hasOnlyOptionalShift(chord)) {
    return codeEditorPlainCodes.has(chord.code)
      || chord.code === 'F3'
      || /^(?:Key|Digit)/.test(chord.code)
      || isPunctuationCode(chord.code)
  }

  const primary = resolvePrimaryModifier(platform)
  const primaryCodes = new Set([
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'Backspace',
    'BracketLeft',
    'BracketRight',
    'Delete',
    'End',
    'Enter',
    'Home',
    'KeyA',
    'KeyC',
    'KeyD',
    'KeyF',
    'KeyG',
    'KeyI',
    'KeyU',
    'KeyV',
    'KeyX',
    'KeyY',
    'KeyZ',
    'Slash',
  ])
  if (
    primaryCodes.has(chord.code)
    && chord.modifiers.includes(primary)
    && chord.modifiers.every((modifier) => modifier === primary || modifier === 'shift')
  ) {
    return true
  }
  if (
    chord.modifiers.includes('alt')
    && ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyL', 'KeyU'].includes(chord.code)
  ) {
    return true
  }
  if (
    matches(chord, 'Space', ['control'])
    || matches(chord, 'BracketLeft', ['control', 'alt'])
    || matches(chord, 'BracketRight', ['control', 'alt'])
  ) {
    return true
  }
  if (platform !== 'darwin') {
    return false
  }
  return chord.modifiers.includes('control')
    && ['KeyA', 'KeyB', 'KeyD', 'KeyE', 'KeyF', 'KeyH', 'KeyK', 'KeyN', 'KeyO', 'KeyP', 'KeyT', 'KeyV'].includes(chord.code)
}

function isPunctuationCode(code: string) {
  return [
    'Backquote',
    'Backslash',
    'BracketLeft',
    'BracketRight',
    'Comma',
    'Equal',
    'IntlBackslash',
    'Minus',
    'Period',
    'Quote',
    'Semicolon',
    'Slash',
  ].includes(code)
}
