import type {
  NormalizeShortcutEventOptions,
  ShortcutChord,
  ShortcutKeyboardEventLike,
  ShortcutModifier,
  ShortcutPlatform,
} from './types.ts'

const shortcutModifiers = [
  'primary',
  'control',
  'alt',
  'shift',
  'meta',
] as const satisfies readonly ShortcutModifier[]

const concreteModifierOrder = [
  'control',
  'alt',
  'shift',
  'meta',
] as const satisfies readonly ShortcutModifier[]

const modifierOrder = new Map<ShortcutModifier, number>(
  shortcutModifiers.map((modifier, index) => [modifier, index]),
)

const modifierCodes = new Set([
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'ShiftLeft',
  'ShiftRight',
])

const invalidEventKeys = new Set([
  'Compose',
  'Dead',
  'Process',
  'Unidentified',
])

const keyLabels: Readonly<Record<string, string>> = {
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  Backspace: 'Backspace',
  ContextMenu: 'Menu',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Escape: 'Esc',
  Home: 'Home',
  Insert: 'Insert',
  NumpadEnter: 'Enter',
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  Space: 'Space',
  Tab: 'Tab',
}

export function normalizeShortcutPlatform(value?: string): ShortcutPlatform {
  const platform = value ?? globalThis.navigator?.platform ?? ''
  const normalized = platform.toLowerCase()
  if (normalized === 'darwin' || normalized.includes('mac')) {
    return 'darwin'
  }
  if (normalized === 'win32' || normalized.includes('win')) {
    return 'win32'
  }
  return 'linux'
}

export function resolvePrimaryModifier(
  platform: ShortcutPlatform,
): Exclude<ShortcutModifier, 'primary'> {
  return platform === 'darwin' ? 'meta' : 'control'
}

export function isSupportedShortcutCode(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value)
    && value !== 'Unidentified'
    && !modifierCodes.has(value)
}

export function normalizeShortcutChord(value: unknown): ShortcutChord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const chord = value as Record<string, unknown>
  if (
    !isSupportedShortcutCode(chord.code)
    || !isSupportedShortcutKey(chord.key)
    || !Array.isArray(chord.modifiers)
    || !chord.modifiers.every(isShortcutModifier)
    || new Set(chord.modifiers).size !== chord.modifiers.length
  ) {
    return null
  }
  return {
    code: chord.code,
    key: normalizeShortcutKey(chord.key),
    modifiers: canonicalizeShortcutModifiers(chord.modifiers),
  }
}

export function createShortcutChord(
  code: string,
  key: string,
  modifiers: readonly ShortcutModifier[] = [],
): ShortcutChord {
  const chord = normalizeShortcutChord({ code, key, modifiers: [...modifiers] })
  if (!chord) {
    throw new TypeError(`Invalid shortcut chord: ${code}`)
  }
  return chord
}

export function resolveShortcutChord(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
): ShortcutChord {
  const concrete = chord.modifiers.map((modifier) => (
    modifier === 'primary' ? resolvePrimaryModifier(platform) : modifier
  ))
  const modifiers = [...new Set(concrete)].sort((left, right) => (
    concreteModifierOrder.indexOf(left) - concreteModifierOrder.indexOf(right)
  ))
  return {
    code: chord.code,
    key: chord.key,
    modifiers,
  }
}

export function shortcutChordSignature(
  chord: ShortcutChord,
  platform?: ShortcutPlatform,
) {
  const resolved = platform ? resolveShortcutChord(chord, platform) : chord
  return `${resolved.modifiers.join('+')}|${resolved.code}`
}

export const serializeShortcutChord = shortcutChordSignature

export function shortcutChordsEqual(
  left: ShortcutChord,
  right: ShortcutChord,
  platform?: ShortcutPlatform,
) {
  return shortcutChordSignature(left, platform) === shortcutChordSignature(right, platform)
}

export function formatShortcutChord(
  chord: ShortcutChord,
  platform: ShortcutPlatform,
) {
  const resolved = resolveShortcutChord(chord, platform)
  const keyLabel = formatShortcutKey(resolved)
  if (platform === 'darwin') {
    const modifiers = resolved.modifiers.map((modifier) => {
      switch (modifier) {
        case 'control':
          return '⌃'
        case 'alt':
          return '⌥'
        case 'shift':
          return '⇧'
        case 'meta':
          return '⌘'
        default:
          return ''
      }
    }).join('')
    return `${modifiers}${keyLabel}`
  }

  const modifiers = resolved.modifiers.map((modifier) => {
    switch (modifier) {
      case 'control':
        return 'Ctrl'
      case 'alt':
        return 'Alt'
      case 'shift':
        return 'Shift'
      case 'meta':
        return 'Meta'
      default:
        return ''
    }
  })
  return [...modifiers, keyLabel].filter(Boolean).join('+')
}

export function normalizeKeyboardEventToChord(
  event: ShortcutKeyboardEventLike,
  options: NormalizeShortcutEventOptions = {},
): ShortcutChord | null {
  if (
    (event.type !== undefined && event.type !== 'keydown')
    || (event.defaultPrevented && !options.allowDefaultPrevented)
    || event.isComposing
    || event.keyCode === 229
    || invalidEventKeys.has(event.key)
    || !isSupportedShortcutCode(event.code)
    || !isSupportedShortcutKey(event.key)
    || hasAltGraphModifier(event)
  ) {
    return null
  }

  const modifiers: ShortcutModifier[] = []
  if (event.ctrlKey) modifiers.push('control')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  if (event.metaKey) modifiers.push('meta')

  if (options.mapPrimaryModifier) {
    const primary = resolvePrimaryModifier(
      options.platform ?? normalizeShortcutPlatform(),
    )
    const index = modifiers.indexOf(primary)
    if (index >= 0) {
      modifiers.splice(index, 1, 'primary')
    }
  }

  return createShortcutChord(event.code, event.key, modifiers)
}

function canonicalizeShortcutModifiers(
  modifiers: readonly ShortcutModifier[],
): ShortcutModifier[] {
  return [...modifiers].sort((left, right) => (
    (modifierOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (modifierOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  ))
}

function isShortcutModifier(value: unknown): value is ShortcutModifier {
  return typeof value === 'string'
    && shortcutModifiers.includes(value as ShortcutModifier)
}

function isSupportedShortcutKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || Array.from(value).length > 64) {
    return false
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return false
    }
  }
  return true
}

function normalizeShortcutKey(value: string) {
  if (value === 'Esc') return 'Escape'
  if (value === 'Spacebar') return ' '
  return value
}

function formatShortcutKey(chord: ShortcutChord) {
  const mapped = keyLabels[chord.code]
  if (mapped) {
    return mapped
  }
  if (chord.code.startsWith('Key')) {
    return chord.key.toLocaleUpperCase('en-US')
  }
  if (chord.code.startsWith('Digit')) {
    return chord.key
  }
  if (chord.key === ' ') {
    return 'Space'
  }
  return chord.key
}

function hasAltGraphModifier(event: ShortcutKeyboardEventLike) {
  if (!event.getModifierState) {
    return false
  }
  try {
    return event.getModifierState('AltGraph')
  } catch {
    return true
  }
}
