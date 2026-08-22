import type {
  AdvancedRenameOrder,
  AdvancedRenamePlanInput,
  AdvancedRenamePreviewItem,
  AdvancedRenamePreview,
  AdvancedRenamePreviewStatus,
  AdvancedRenameRule,
  AdvancedRenameRuleKind,
  AdvancedRenameVariableDefinition,
  FileRenamePreset,
  FileRenamePresetInput,
  FileSession,
  RemoteFileEntry,
} from '#entities/file'

export const defaultAdvancedRenameOrder: AdvancedRenameOrder = {
  by: 'selection',
  direction: 'asc',
}

export const advancedRenameRuleKinds: AdvancedRenameRuleKind[] = [
  'template',
  'insert',
  'replace',
  'slice',
  'case',
  'cleanup',
  'sequence',
  'extension',
]

export type AdvancedRenameRuleChoice = AdvancedRenameRuleKind | 'regex'

export const advancedRenameRuleChoices: AdvancedRenameRuleChoice[] = [
  'template',
  'insert',
  'replace',
  'regex',
  'slice',
  'case',
  'cleanup',
  'sequence',
  'extension',
]

export const advancedRenameRuleLimit = 32
export const advancedRenameVariableLimit = 32
export const advancedRenameSourceLimit = 500

export type AdvancedRenameSourceValidation =
  | { valid: true }
  | { valid: false; reason: 'empty' | 'unsupported' | 'too_many' }

export function validateAdvancedRenameSource(
  entries: readonly RemoteFileEntry[],
): AdvancedRenameSourceValidation {
  if (entries.length === 0) {
    return { valid: false, reason: 'empty' }
  }
  if (entries.length > advancedRenameSourceLimit) {
    return { valid: false, reason: 'too_many' }
  }
  if (entries.some((entry) => entry.kind === 'other')) {
    return { valid: false, reason: 'unsupported' }
  }
  return { valid: true }
}

export function isAdvancedRenameSourceSessionCurrent(
  source: { fileSessionId: string; connectionGeneration: number },
  session: Pick<FileSession, 'id' | 'status' | 'connection_generation'> | null | undefined,
  closing = false,
) {
  return !closing
    && session?.id === source.fileSessionId
    && session.status === 'connected'
    && (session.connection_generation ?? 0) === source.connectionGeneration
}

export const advancedRenamePlaceholders = [
  { token: '{{file.original}}', labelKey: 'files.advancedRename.placeholders.original' },
  { token: '{{file.name}}', labelKey: 'files.advancedRename.placeholders.name' },
  { token: '{{file.stem}}', labelKey: 'files.advancedRename.placeholders.stem' },
  { token: '{{file.ext}}', labelKey: 'files.advancedRename.placeholders.extension' },
  { token: '{{file.parent}}', labelKey: 'files.advancedRename.placeholders.parent' },
  { token: '{{file.kind}}', labelKey: 'files.advancedRename.placeholders.kind' },
  { token: '{{file.size}}', labelKey: 'files.advancedRename.placeholders.size' },
  { token: '{{file.modified:yyyy-MM-dd}}', labelKey: 'files.advancedRename.placeholders.modified' },
  { token: '{{index:000}}', labelKey: 'files.advancedRename.placeholders.index' },
] as const

export type AdvancedRenamePreviewFilter =
  | 'all'
  | 'changed'
  | 'issues'
  | AdvancedRenamePreviewStatus

export interface AdvancedRenameVirtualWindow {
  start: number
  end: number
  offset: number
  totalHeight: number
}

export function advancedRenameVirtualWindow(
  totalItems: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 38,
  overscan = 5,
): AdvancedRenameVirtualWindow {
  const safeTotal = Math.max(0, Math.trunc(totalItems))
  const safeRowHeight = Math.max(1, rowHeight)
  const safeViewportHeight = Math.max(safeRowHeight, viewportHeight)
  const firstVisible = Math.min(
    safeTotal,
    Math.floor(Math.max(0, scrollTop) / safeRowHeight),
  )
  const visibleCount = Math.ceil(safeViewportHeight / safeRowHeight)
  const start = Math.min(safeTotal, Math.max(0, firstVisible - overscan))
  const end = Math.min(safeTotal, firstVisible + visibleCount + overscan)
  return {
    start,
    end,
    offset: start * safeRowHeight,
    totalHeight: safeTotal * safeRowHeight,
  }
}

export function createAdvancedRenameRule(choice: AdvancedRenameRuleChoice): AdvancedRenameRule {
  const base = { id: createRuleId(), enabled: true }
  switch (choice) {
    case 'template':
      return { ...base, kind: choice, config: { template: '{{file.original}}' } }
    case 'insert':
      return { ...base, kind: choice, config: { text: '', position: 'prefix', target: 'stem' } }
    case 'replace':
    case 'regex':
      return {
        ...base,
        kind: 'replace',
        config: {
          search: '',
          replacement: '',
          regex: choice === 'regex',
          replace_all: true,
          case_sensitive: true,
          target: 'stem',
        },
      }
    case 'slice':
      return {
        ...base,
        kind: choice,
        config: { mode: 'remove', start: 0, length: 1, from_end: false, target: 'stem' },
      }
    case 'case':
      return { ...base, kind: choice, config: { mode: 'lower', target: 'stem' } }
    case 'cleanup':
      return {
        ...base,
        kind: choice,
        config: { trim_whitespace: true, separator: '_', collapse_separator: true, target: 'stem' },
      }
    case 'sequence':
      return {
        ...base,
        kind: choice,
        config: { position: 'suffix', start: 1, step: 1, width: 3, target: 'stem' },
      }
    case 'extension':
      return { ...base, kind: choice, config: { mode: 'set', value: '' } }
  }
}

export function advancedRenameRuleChoice(rule: AdvancedRenameRule): AdvancedRenameRuleChoice {
  return rule.kind === 'replace' && rule.config.regex ? 'regex' : rule.kind
}

export function defaultAdvancedRenameRules(): AdvancedRenameRule[] {
  return [createAdvancedRenameRule('template')]
}

export function cloneAdvancedRenameRules(rules: readonly AdvancedRenameRule[]) {
  return rules.map((rule) => structuredClone(rule))
}

export function moveAdvancedRenameRule(
  rules: AdvancedRenameRule[],
  ruleId: string,
  targetIndex: number,
) {
  const currentIndex = rules.findIndex((rule) => rule.id === ruleId)
  if (
    currentIndex < 0
    || targetIndex < 0
    || targetIndex >= rules.length
    || currentIndex === targetIndex
  ) {
    return rules
  }
  const next = [...rules]
  const [moved] = next.splice(currentIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

export function duplicateAdvancedRenameRule(rule: AdvancedRenameRule) {
  return { ...structuredClone(rule), id: createRuleId() } as AdvancedRenameRule
}

export function defaultAdvancedRenameVariables(
  definitions: readonly AdvancedRenameVariableDefinition[],
) {
  return Object.fromEntries(definitions.map((definition) => [definition.name, definition.default_value]))
}

export function resolveAdvancedRenameVariables(
  definitions: readonly AdvancedRenameVariableDefinition[],
  overrides: Readonly<Record<string, string>>,
) {
  return Object.fromEntries(definitions.map((definition) => [
    definition.name,
    Object.prototype.hasOwnProperty.call(overrides, definition.name)
      ? overrides[definition.name]
      : definition.default_value,
  ]))
}

export function missingRequiredAdvancedRenameVariables(
  definitions: readonly AdvancedRenameVariableDefinition[],
  values: Readonly<Record<string, string>>,
) {
  return definitions.filter((definition) => (
    definition.required && !(values[definition.name] ?? '').trim()
  ))
}

export function advancedRenameVariableToken(name: string) {
  return `{{vars.${name}}}`
}

export function isAdvancedRenameVariableName(value: string) {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
}

export type AdvancedRenameVariableDefinitionError = 'invalid' | 'duplicate' | null

export function advancedRenameVariableDefinitionErrors(
  definitions: readonly AdvancedRenameVariableDefinition[],
): AdvancedRenameVariableDefinitionError[] {
  const counts = new Map<string, number>()
  for (const definition of definitions) {
    counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1)
  }
  return definitions.map((definition) => {
    if (!isAdvancedRenameVariableName(definition.name)) {
      return 'invalid'
    }
    return (counts.get(definition.name) ?? 0) > 1 ? 'duplicate' : null
  })
}

export function buildAdvancedRenamePlanInput(input: {
  connectionGeneration: number
  directory: string
  sourcePaths: readonly string[]
  excludedPaths: ReadonlySet<string>
  rules: readonly AdvancedRenameRule[]
  variables: Readonly<Record<string, string>>
  order: AdvancedRenameOrder
  manualOverrides: Readonly<Record<string, string>>
}): AdvancedRenamePlanInput {
  const sourcePathSet = new Set(input.sourcePaths)
  return {
    expected_connection_generation: input.connectionGeneration,
    directory: input.directory,
    source_paths: [...input.sourcePaths],
    excluded_paths: input.sourcePaths.filter((path) => input.excludedPaths.has(path)),
    rules: cloneAdvancedRenameRules(input.rules),
    variables: { ...input.variables },
    order: { ...input.order },
    manual_overrides: Object.fromEntries(
      Object.entries(input.manualOverrides).filter(([path]) => sourcePathSet.has(path)),
    ),
  }
}

export function fileRenamePresetInput(input: {
  name: string
  description: string
  rules: readonly AdvancedRenameRule[]
  order: AdvancedRenameOrder
  variableDefinitions: readonly AdvancedRenameVariableDefinition[]
}): FileRenamePresetInput {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    rules: cloneAdvancedRenameRules(input.rules),
    order: { ...input.order },
    variable_definitions: input.variableDefinitions.map((definition) => ({ ...definition })),
  }
}

function stableAdvancedRenamePresetStringify(value: unknown) {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (nestedValue === null || typeof nestedValue !== 'object' || Array.isArray(nestedValue)) {
      return nestedValue
    }
    return Object.fromEntries(Object.entries(nestedValue).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    )))
  })
}

export function advancedRenamePresetFingerprint(input: {
  rules: readonly AdvancedRenameRule[]
  order: AdvancedRenameOrder
  variableDefinitions: readonly AdvancedRenameVariableDefinition[]
}) {
  return stableAdvancedRenamePresetStringify({
    rules: input.rules.map((rule) => rule.condition ? {
      ...rule,
      condition: {
        ...rule.condition,
        kinds: rule.condition.kinds ?? [],
        extensions: rule.condition.extensions ?? [],
      },
    } : rule),
    order: input.order,
    variable_definitions: input.variableDefinitions,
  })
}

export function presetFingerprint(preset: FileRenamePreset) {
  return advancedRenamePresetFingerprint({
    rules: preset.rules,
    order: preset.order,
    variableDefinitions: preset.variable_definitions,
  })
}

export function filterAdvancedRenamePreviewItems(
  items: readonly AdvancedRenamePreviewItem[],
  filter: AdvancedRenamePreviewFilter,
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    const matchesFilter = filter === 'all'
      || (filter === 'changed' && item.status === 'ready')
      || (filter === 'issues' && (
        item.status === 'conflict' || item.status === 'invalid' || item.status === 'missing'
      ))
      || item.status === filter
    if (!matchesFilter) {
      return false
    }
    return !normalizedQuery
      || item.original_name.toLocaleLowerCase().includes(normalizedQuery)
      || item.final_name.toLocaleLowerCase().includes(normalizedQuery)
      || item.source_path.toLocaleLowerCase().includes(normalizedQuery)
  })
}

export function advancedRenameRuleDiagnostics(
  preview: AdvancedRenamePreview | null | undefined,
): Readonly<Record<string, string[]>> {
  const diagnostics: Record<string, string[]> = {}
  for (const item of preview?.items ?? []) {
    for (const diagnostic of item.diagnostics ?? []) {
      if (!diagnostic.rule_id || !diagnostic.message) {
        continue
      }
      const messages = diagnostics[diagnostic.rule_id] ?? (diagnostics[diagnostic.rule_id] = [])
      if (!messages.includes(diagnostic.message)) {
        messages.push(diagnostic.message)
      }
    }
  }
  return diagnostics
}

function createRuleId() {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2, 12)
  return `rename_rule_${randomId}`
}
