import type {
  ShortcutActionOverride,
  ShortcutChord,
  ShortcutModifier,
  ShortcutSettings,
} from '../../types/domain'

export const SHORTCUT_ACTION_IDS = [
  'app.host_launcher.open',
  'terminal.copy_selection',
  'terminal.paste',
  'terminal.completion.previous',
  'terminal.completion.next',
  'terminal.completion.accept',
  'terminal.search.open',
  'terminal.select_all',
  'terminal.session.reconnect',
  'files.select_all',
  'files.open_focused',
  'files.rename_focused',
  'files.delete_selection',
  'files.editor.save',
] as const

export type ShortcutActionId = typeof SHORTCUT_ACTION_IDS[number]

export const SHORTCUT_SCOPES = [
  'app.global',
  'terminal.selection',
  'terminal.writable',
  'terminal.completion.visible',
  'terminal.active',
  'terminal.disconnected',
  'files.standalone',
  'files.list',
  'files.editor',
] as const

export type ShortcutScope = typeof SHORTCUT_SCOPES[number]
export type ShortcutPlatform = 'darwin' | 'win32' | 'linux'
export type ShortcutBindingSource = 'default' | 'override'
export type ShortcutActionGroup = 'global' | 'terminal' | 'completion' | 'files' | 'editor'
export type ShortcutConflictDomain = 'application' | 'terminal' | 'files' | 'editor'

export interface ShortcutActionDefinition {
  readonly id: ShortcutActionId
  readonly group: ShortcutActionGroup
  readonly scope: ShortcutScope
  readonly defaultBindings: readonly ShortcutChord[]
  readonly allowInEditable: boolean
  readonly allowRepeat: boolean
  readonly conflictDomains: readonly ShortcutConflictDomain[]
  readonly customizable: true
}

export interface EffectiveShortcutBinding {
  readonly actionId: ShortcutActionId
  readonly scope: ShortcutScope
  readonly bindings: readonly ShortcutChord[]
  readonly source: ShortcutBindingSource
}

export type ShortcutBindingOverrides = Readonly<
  Record<string, ShortcutActionOverride | undefined>
>

export type ShortcutBindingsInput =
  | ShortcutSettings
  | ShortcutBindingOverrides
  | readonly EffectiveShortcutBinding[]

export interface ShortcutKeyboardEventLike {
  readonly type?: string
  readonly code: string
  readonly key: string
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
  readonly repeat?: boolean
  readonly defaultPrevented?: boolean
  readonly isComposing?: boolean
  readonly keyCode?: number
  readonly getModifierState?: (key: string) => boolean
}

export interface NormalizeShortcutEventOptions {
  readonly platform?: ShortcutPlatform
  readonly mapPrimaryModifier?: boolean
  readonly allowDefaultPrevented?: boolean
}

export type ShortcutReservationId =
  | 'focus_traversal'
  | 'dismiss'
  | 'context_menu'
  | 'diagnostics'
  | 'aria_navigation'
  | 'file_selection'
  | 'terminal_search'
  | 'terminal_interrupt'
  | 'code_editor'

export interface ShortcutReservation {
  readonly id: ShortcutReservationId
  readonly chord: ShortcutChord
  readonly actionId: ShortcutActionId
  readonly scope: ShortcutScope
}

export type ShortcutBindingIssueCode =
  | 'too_many_bindings'
  | 'invalid_chord'
  | 'duplicate_binding'
  | 'reserved_binding'

export interface ShortcutBindingIssue {
  readonly code: ShortcutBindingIssueCode
  readonly actionId: ShortcutActionId
  readonly bindingIndex?: number
  readonly reservation?: ShortcutReservation
}

export interface ShortcutConflict {
  readonly chord: ShortcutChord
  readonly firstActionId: ShortcutActionId
  readonly firstScope: ShortcutScope
  readonly secondActionId: ShortcutActionId
  readonly secondScope: ShortcutScope
}

export interface ShortcutIndexEntry {
  readonly actionId: ShortcutActionId
  readonly scope: ShortcutScope
  readonly chord: ShortcutChord
}

export interface ShortcutIndex {
  readonly platform: ShortcutPlatform
  readonly byChord: ReadonlyMap<string, readonly ShortcutIndexEntry[]>
}

export type {
  ShortcutActionOverride,
  ShortcutChord,
  ShortcutModifier,
  ShortcutSettings,
}
