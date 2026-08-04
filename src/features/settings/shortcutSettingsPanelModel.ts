import {
  findShortcutBindingConflicts,
  findShortcutConflicts,
  getShortcutAction,
  resolveEffectiveShortcutBindings,
  shortcutBindingListsEqual,
  SHORTCUT_ACTIONS,
  validateShortcutBindings,
  type ShortcutActionDefinition,
  type ShortcutActionGroup,
  type ShortcutActionId,
  type ShortcutBindingIssue,
  type ShortcutChord,
  type ShortcutConflict,
  type ShortcutPlatform,
} from '../shortcuts/index.ts'
import type {
  ShortcutActionOverride,
  ShortcutSettings,
} from '../../types/domain'

export const shortcutGroupOrder = [
  'global',
  'terminal',
  'completion',
  'files',
  'editor',
] as const satisfies readonly ShortcutActionGroup[]

export type ShortcutRowStatus = 'default' | 'custom' | 'unbound'

export interface ShortcutSettingsRow {
  definition: ShortcutActionDefinition
  bindings: readonly ShortcutChord[]
  conflicts: readonly ShortcutConflict[]
  status: ShortcutRowStatus
  customized: boolean
}

export interface ShortcutDraftValidation {
  issues: readonly ShortcutBindingIssue[]
  conflicts: readonly ShortcutConflict[]
  valid: boolean
}

export interface ShortcutEditorState {
  actionId: ShortcutActionId
  bindings: ShortcutChord[]
  recordingIndex: number | null
}

export function buildShortcutSettingsRows(
  settings: ShortcutSettings,
  platform: ShortcutPlatform,
): readonly ShortcutSettingsRow[] {
  const effective = resolveEffectiveShortcutBindings(settings)
  const effectiveByAction = new Map(effective.map((binding) => [binding.actionId, binding]))
  const conflicts = findShortcutConflicts(effective, platform)

  return SHORTCUT_ACTIONS.map((definition) => {
    const effective = effectiveByAction.get(definition.id)
    const bindings = effective?.bindings ?? definition.defaultBindings
    return {
      definition,
      bindings,
      conflicts: conflicts.filter((conflict) => (
        conflict.firstActionId === definition.id || conflict.secondActionId === definition.id
      )),
      status: bindings.length === 0
        ? 'unbound'
        : effective?.source === 'override' ? 'custom' : 'default',
      customized: effective?.source === 'override',
    }
  })
}

export function groupShortcutSettingsRows(
  rows: readonly ShortcutSettingsRow[],
) {
  return shortcutGroupOrder.map((group) => ({
    group,
    rows: rows.filter((row) => row.definition.group === group),
  })).filter((entry) => entry.rows.length > 0)
}

export function filterShortcutSettingsRows(
  rows: readonly ShortcutSettingsRow[],
  query: string,
  searchableText: (row: ShortcutSettingsRow) => readonly string[],
) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return rows
  return rows.filter((row) => searchableText(row).some((value) => (
    value.toLocaleLowerCase().includes(normalized)
  )))
}

export function validateShortcutDraft(
  actionId: ShortcutActionId,
  bindings: readonly ShortcutChord[],
  settings: ShortcutSettings,
  platform: ShortcutPlatform,
): ShortcutDraftValidation {
  const issues = validateShortcutBindings(actionId, bindings, platform)
  const conflicts = findShortcutBindingConflicts(actionId, bindings, settings, platform)
  return {
    issues,
    conflicts,
    valid: issues.length === 0 && conflicts.length === 0,
  }
}

export function createShortcutBindingChange(
  actionId: ShortcutActionId,
  bindings: readonly ShortcutChord[],
): ShortcutActionOverride | null {
  const defaults = getShortcutAction(actionId).defaultBindings
  if (shortcutBindingListsEqual(bindings, defaults)) {
    return null
  }
  return {
    bindings: bindings.map((binding) => ({
      ...binding,
      modifiers: [...binding.modifiers],
    })),
  }
}

export function shortcutActionTranslationSegment(actionId: ShortcutActionId) {
  return actionId.replace(/\./g, '_')
}

export function shortcutScopeTranslationSegment(scope: string) {
  return scope.replace(/\./g, '_')
}
