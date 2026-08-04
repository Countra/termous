import {
  normalizeKeyboardEventToChord,
  normalizeShortcutChord,
  resolveShortcutChord,
  shortcutChordSignature,
  shortcutChordsEqual,
} from './chords.ts'
import {
  getShortcutAction,
  isShortcutActionId,
  SHORTCUT_ACTIONS,
} from './registry.ts'
import { getShortcutReservation } from './reserved.ts'
import { shortcutScopePriority, shortcutScopesOverlap } from './scopes.ts'
import type {
  EffectiveShortcutBinding,
  ShortcutActionId,
  ShortcutActionOverride,
  ShortcutBindingIssue,
  ShortcutBindingOverrides,
  ShortcutBindingsInput,
  ShortcutChord,
  ShortcutConflict,
  ShortcutIndex,
  ShortcutIndexEntry,
  ShortcutKeyboardEventLike,
  ShortcutPlatform,
  ShortcutScope,
  ShortcutSettings,
} from './types.ts'

export const MAX_SHORTCUT_BINDINGS = 2

export function resolveEffectiveShortcutBindings(
  input: ShortcutSettings | ShortcutBindingOverrides = {},
): readonly EffectiveShortcutBinding[] {
  const overrides = readOverrides(input)
  return SHORTCUT_ACTIONS.map((action) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, action.id)
    const override = overrides[action.id]
    const normalized = hasOverride
      ? normalizeBindingList(override?.bindings)
      : null
    return {
      actionId: action.id,
      scope: action.scope,
      bindings: hasOverride ? normalized ?? [] : action.defaultBindings,
      source: hasOverride ? 'override' : 'default',
    }
  })
}

export function setShortcutBindingOverride(
  input: ShortcutSettings | ShortcutBindingOverrides,
  actionId: ShortcutActionId,
  bindings: readonly ShortcutChord[],
): Record<string, ShortcutActionOverride> {
  const normalized = normalizeBindingList(bindings)
  if (!normalized) {
    throw new TypeError(`Invalid bindings for shortcut action: ${actionId}`)
  }

  const next = copyOverrides(readOverrides(input))
  const defaults = getShortcutAction(actionId).defaultBindings
  if (shortcutBindingListsEqual(normalized, defaults)) {
    delete next[actionId]
  } else {
    next[actionId] = { bindings: normalized.map(copyChord) }
  }
  return next
}

export function resetShortcutBindingOverride(
  input: ShortcutSettings | ShortcutBindingOverrides,
  actionId: ShortcutActionId,
): Record<string, ShortcutActionOverride> {
  const next = copyOverrides(readOverrides(input))
  delete next[actionId]
  return next
}

export function shortcutBindingListsEqual(
  first: readonly ShortcutChord[],
  second: readonly ShortcutChord[],
  platform?: ShortcutPlatform,
) {
  if (first.length !== second.length) {
    return false
  }
  const firstSignatures = first
    .map((chord) => shortcutChordSignature(chord, platform))
    .sort()
  const secondSignatures = second
    .map((chord) => shortcutChordSignature(chord, platform))
    .sort()
  return firstSignatures.every((signature, index) => signature === secondSignatures[index])
}

export function validateShortcutBindings(
  actionId: ShortcutActionId,
  bindings: readonly unknown[],
  platform: ShortcutPlatform,
): readonly ShortcutBindingIssue[] {
  const issues: ShortcutBindingIssue[] = []
  if (bindings.length > MAX_SHORTCUT_BINDINGS) {
    issues.push({ code: 'too_many_bindings', actionId })
  }

  const signatures = new Set<string>()
  bindings.forEach((value, bindingIndex) => {
    const chord = normalizeShortcutChord(value)
    if (!chord) {
      issues.push({ code: 'invalid_chord', actionId, bindingIndex })
      return
    }
    const signature = shortcutChordSignature(chord, platform)
    if (signatures.has(signature)) {
      issues.push({ code: 'duplicate_binding', actionId, bindingIndex })
      return
    }
    signatures.add(signature)
    const reservation = getShortcutReservation(actionId, chord, platform)
    if (reservation) {
      issues.push({
        code: 'reserved_binding',
        actionId,
        bindingIndex,
        reservation,
      })
    }
  })
  return issues
}

export function findShortcutConflicts(
  input: ShortcutBindingsInput,
  platform: ShortcutPlatform,
): readonly ShortcutConflict[] {
  const effective = effectiveBindingsFromInput(input)
  const conflicts: ShortcutConflict[] = []
  const seen = new Set<string>()

  for (let firstIndex = 0; firstIndex < effective.length; firstIndex += 1) {
    const first = effective[firstIndex]
    if (!first) continue
    for (let secondIndex = firstIndex + 1; secondIndex < effective.length; secondIndex += 1) {
      const second = effective[secondIndex]
      if (!second || !shortcutScopesOverlap(first.scope, second.scope)) continue
      for (const firstChord of first.bindings) {
        for (const secondChord of second.bindings) {
          if (!shortcutChordsEqual(firstChord, secondChord, platform)) continue
          const signature = [
            first.actionId,
            second.actionId,
            shortcutChordSignature(firstChord, platform),
          ].join('|')
          if (seen.has(signature)) continue
          seen.add(signature)
          conflicts.push({
            chord: resolveShortcutChord(firstChord, platform),
            firstActionId: first.actionId,
            firstScope: first.scope,
            secondActionId: second.actionId,
            secondScope: second.scope,
          })
        }
      }
    }
  }
  return conflicts
}

export function findShortcutBindingConflicts(
  actionId: ShortcutActionId,
  bindings: readonly ShortcutChord[],
  input: ShortcutSettings | ShortcutBindingOverrides,
  platform: ShortcutPlatform,
) {
  const effective = resolveEffectiveShortcutBindings(input).map((entry) => (
    entry.actionId === actionId ? { ...entry, bindings } : entry
  ))
  return findShortcutConflicts(effective, platform).filter((conflict) => (
    conflict.firstActionId === actionId || conflict.secondActionId === actionId
  ))
}

export function compileShortcutIndex(
  input: ShortcutBindingsInput,
  platform: ShortcutPlatform,
): ShortcutIndex {
  const byChord = new Map<string, ShortcutIndexEntry[]>()
  const actionOrder = new Map(
    SHORTCUT_ACTIONS.map((action, index) => [action.id, index]),
  )

  for (const effective of effectiveBindingsFromInput(input)) {
    for (const value of effective.bindings) {
      const chord = normalizeShortcutChord(value)
      if (!chord) continue
      const signature = shortcutChordSignature(chord, platform)
      const entries = byChord.get(signature) ?? []
      if (entries.some((entry) => entry.actionId === effective.actionId)) continue
      entries.push({
        actionId: effective.actionId,
        scope: effective.scope,
        chord: resolveShortcutChord(chord, platform),
      })
      byChord.set(signature, entries)
    }
  }

  for (const entries of byChord.values()) {
    entries.sort((first, second) => (
      shortcutScopePriority(second.scope) - shortcutScopePriority(first.scope)
      || (actionOrder.get(first.actionId) ?? 0) - (actionOrder.get(second.actionId) ?? 0)
    ))
  }
  return { platform, byChord }
}

export function matchShortcutEvent(
  index: ShortcutIndex,
  event: ShortcutKeyboardEventLike,
  activeScopes: Iterable<ShortcutScope>,
): ShortcutIndexEntry | null {
  const chord = normalizeKeyboardEventToChord(event)
  if (!chord) return null
  const entries = index.byChord.get(shortcutChordSignature(chord, index.platform))
  if (!entries) return null
  const active = new Set(activeScopes)
  return entries.find((entry) => (
    entry.scope === 'app.global' || active.has(entry.scope)
  )) ?? null
}

export function matchShortcutAction(
  index: ShortcutIndex,
  event: ShortcutKeyboardEventLike,
  activeScopes: Iterable<ShortcutScope>,
) {
  return matchShortcutEvent(index, event, activeScopes)?.actionId ?? null
}

function effectiveBindingsFromInput(
  input: ShortcutBindingsInput,
): readonly EffectiveShortcutBinding[] {
  if (isEffectiveShortcutBindingList(input)) {
    return input.flatMap((entry) => {
      if (!isShortcutActionId(entry.actionId)) return []
      const action = getShortcutAction(entry.actionId)
      const bindings = normalizeBindingList(entry.bindings) ?? []
      return [{
        actionId: action.id,
        scope: action.scope,
        bindings,
        source: entry.source,
      } satisfies EffectiveShortcutBinding]
    })
  }
  return resolveEffectiveShortcutBindings(input)
}

function normalizeBindingList(value: unknown): ShortcutChord[] | null {
  if (!Array.isArray(value) || value.length > MAX_SHORTCUT_BINDINGS) {
    return null
  }
  const bindings: ShortcutChord[] = []
  const signatures = new Set<string>()
  for (const candidate of value) {
    const chord = normalizeShortcutChord(candidate)
    if (!chord) return null
    const signature = shortcutChordSignature(chord)
    if (signatures.has(signature)) return null
    signatures.add(signature)
    bindings.push(chord)
  }
  return bindings
}

function readOverrides(
  input: ShortcutSettings | ShortcutBindingOverrides,
): ShortcutBindingOverrides {
  return isShortcutSettingsInput(input) ? input.overrides : input
}

function isEffectiveShortcutBindingList(
  input: ShortcutBindingsInput,
): input is readonly EffectiveShortcutBinding[] {
  return Array.isArray(input)
}

function isShortcutSettingsInput(
  input: ShortcutSettings | ShortcutBindingOverrides,
): input is ShortcutSettings {
  const candidate = input as Partial<ShortcutSettings>
  return candidate.schema_version === 1
    && candidate.overrides !== null
    && typeof candidate.overrides === 'object'
    && !Array.isArray(candidate.overrides)
}

function copyOverrides(input: ShortcutBindingOverrides) {
  const result: Record<string, ShortcutActionOverride> = {}
  for (const [actionId, override] of Object.entries(input)) {
    if (!override) continue
    result[actionId] = { bindings: override.bindings.map(copyChord) }
  }
  return result
}

function copyChord(chord: ShortcutChord): ShortcutChord {
  return {
    code: chord.code,
    key: chord.key,
    modifiers: [...chord.modifiers],
  }
}
