import type {
  ShortcutActionOverride,
  ShortcutChord,
  ShortcutModifier,
  ShortcutSettings,
  ShortcutSettingsPatch,
} from '../../types/domain'
import { isSupportedShortcutCode } from '#features/shortcuts'

const shortcutActionIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const shortcutModifiers = ['primary', 'control', 'alt', 'shift', 'meta'] as const
const shortcutModifierOrder = new Map<ShortcutModifier, number>(
  shortcutModifiers.map((modifier, index) => [modifier, index]),
)

export const defaultShortcutSettings: ShortcutSettings = {
  schema_version: 1,
  overrides: {},
}

export function normalizeShortcutSettings(value: unknown): ShortcutSettings {
  const settings = asRecord(value)
  const overrides = asRecord(settings?.overrides)
  const normalizedOverrides: Record<string, ShortcutActionOverride> = {}

  for (const actionId of Object.keys(overrides ?? {}).sort()) {
    if (!isShortcutActionId(actionId)) {
      continue
    }
    const override = normalizeShortcutActionOverride(overrides?.[actionId])
    if (override) {
      normalizedOverrides[actionId] = override
    }
  }

  return {
    schema_version: 1,
    overrides: normalizedOverrides,
  }
}

export function applyShortcutSettingsPatch(
  current: ShortcutSettings,
  patch: ShortcutSettingsPatch,
): ShortcutSettings {
  if (patch.reset_all) {
    return normalizeShortcutSettings(defaultShortcutSettings)
  }

  const next = normalizeShortcutSettings(current)
  for (const [actionId, change] of Object.entries(patch.changes ?? {})) {
    if (!isShortcutActionId(actionId)) {
      continue
    }
    if (change === null) {
      delete next.overrides[actionId]
      continue
    }
    const normalized = normalizeShortcutActionOverride(change)
    if (normalized) {
      next.overrides[actionId] = normalized
    }
  }
  return normalizeShortcutSettings(next)
}

export function shortcutSettingsEqual(left: ShortcutSettings, right: ShortcutSettings) {
  return shortcutSettingsSignature(left) === shortcutSettingsSignature(right)
}

export function shortcutSettingsSignature(settings: ShortcutSettings) {
  return JSON.stringify(normalizeShortcutSettings(settings))
}

function normalizeShortcutActionOverride(value: unknown): ShortcutActionOverride | null {
  const override = asRecord(value)
  if (!override || !Array.isArray(override.bindings) || override.bindings.length > 2) {
    return null
  }

  const bindings: ShortcutChord[] = []
  const signatures = new Set<string>()
  for (const value of override.bindings) {
    const chord = normalizeShortcutChord(value)
    if (!chord) {
      return null
    }
    const signature = `${chord.modifiers.join('+')}|${chord.code}`
    if (signatures.has(signature)) {
      return null
    }
    signatures.add(signature)
    bindings.push(chord)
  }

  return { bindings }
}

function normalizeShortcutChord(value: unknown): ShortcutChord | null {
  const chord = asRecord(value)
  if (
    !chord
    || !Array.isArray(chord.modifiers)
    || typeof chord.code !== 'string'
    || typeof chord.key !== 'string'
    || !isSupportedShortcutCode(chord.code)
    || chord.key.length === 0
    || Array.from(chord.key).length > 64
    || containsControlCharacter(chord.key)
  ) {
    return null
  }

  const modifiers = chord.modifiers.filter(isShortcutModifier)
  if (modifiers.length !== chord.modifiers.length || new Set(modifiers).size !== modifiers.length) {
    return null
  }
  modifiers.sort((left, right) => (
    (shortcutModifierOrder.get(left) ?? 0) - (shortcutModifierOrder.get(right) ?? 0)
  ))
  return {
    modifiers,
    code: chord.code,
    key: chord.key,
  }
}

function isShortcutActionId(value: string) {
  return value.length <= 96 && shortcutActionIdPattern.test(value)
}

function isShortcutModifier(value: unknown): value is ShortcutModifier {
  return typeof value === 'string' && shortcutModifiers.includes(value as ShortcutModifier)
}

function containsControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true
    }
  }
  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
