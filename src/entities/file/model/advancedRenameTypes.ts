import type { RemoteFileKind } from './types.ts'

export type AdvancedRenameRuleKind =
  | 'template'
  | 'insert'
  | 'replace'
  | 'slice'
  | 'case'
  | 'cleanup'
  | 'sequence'
  | 'extension'

export type AdvancedRenameTarget = 'name' | 'stem' | 'extension'
export type AdvancedRenameConditionKind = 'file' | 'directory' | 'symlink'

export interface AdvancedRenameNameCondition {
  pattern: string
  regex: boolean
  case_sensitive: boolean
}

export interface AdvancedRenameRuleCondition {
  kinds?: AdvancedRenameConditionKind[]
  original_name?: AdvancedRenameNameCondition
  extensions?: string[]
}

export interface AdvancedRenameRuleBase<Kind extends AdvancedRenameRuleKind, Config> {
  id: string
  kind: Kind
  enabled: boolean
  condition?: AdvancedRenameRuleCondition
  config: Config
}

export interface AdvancedRenameTemplateConfig {
  template: string
}

export interface AdvancedRenameInsertConfig {
  text: string
  position: 'prefix' | 'suffix' | 'index'
  index?: number
  target: AdvancedRenameTarget
}

export interface AdvancedRenameReplaceConfig {
  search: string
  replacement: string
  regex: boolean
  replace_all: boolean
  case_sensitive: boolean
  target: AdvancedRenameTarget
}

export interface AdvancedRenameSliceConfig {
  mode: 'remove' | 'keep'
  start: number
  length?: number
  from_end: boolean
  target: AdvancedRenameTarget
}

export interface AdvancedRenameCaseConfig {
  mode: 'lower' | 'upper' | 'title'
  target: AdvancedRenameTarget
}

export interface AdvancedRenameCleanupConfig {
  trim_whitespace: boolean
  separator?: string
  collapse_separator: boolean
  target: AdvancedRenameTarget
}

export interface AdvancedRenameSequenceConfig {
  position: 'prefix' | 'suffix' | 'index'
  index?: number
  start: number
  step: number
  width: number
  target: AdvancedRenameTarget
}

export interface AdvancedRenameExtensionConfig {
  mode: 'set' | 'remove' | 'lower' | 'upper'
  value?: string
}

export type AdvancedRenameRule =
  | AdvancedRenameRuleBase<'template', AdvancedRenameTemplateConfig>
  | AdvancedRenameRuleBase<'insert', AdvancedRenameInsertConfig>
  | AdvancedRenameRuleBase<'replace', AdvancedRenameReplaceConfig>
  | AdvancedRenameRuleBase<'slice', AdvancedRenameSliceConfig>
  | AdvancedRenameRuleBase<'case', AdvancedRenameCaseConfig>
  | AdvancedRenameRuleBase<'cleanup', AdvancedRenameCleanupConfig>
  | AdvancedRenameRuleBase<'sequence', AdvancedRenameSequenceConfig>
  | AdvancedRenameRuleBase<'extension', AdvancedRenameExtensionConfig>

export interface AdvancedRenameVariableDefinition {
  name: string
  label: string
  description: string
  default_value: string
  required: boolean
}

export interface AdvancedRenameOrder {
  by: 'selection' | 'name' | 'modified' | 'size' | 'kind'
  direction: 'asc' | 'desc'
}

export interface FileRenamePreset {
  id: string
  name: string
  description: string
  rules: AdvancedRenameRule[]
  order: AdvancedRenameOrder
  variable_definitions: AdvancedRenameVariableDefinition[]
  created_at: string
  updated_at: string
}

export interface FileRenamePresetInput {
  name: string
  description: string
  rules: AdvancedRenameRule[]
  order: AdvancedRenameOrder
  variable_definitions: AdvancedRenameVariableDefinition[]
}

export interface AdvancedRenamePlanInput {
  expected_connection_generation: number
  directory: string
  source_paths: string[]
  excluded_paths: string[]
  rules: AdvancedRenameRule[]
  variables: Record<string, string>
  order: AdvancedRenameOrder
  manual_overrides: Record<string, string>
}

export interface AdvancedRenameExecuteInput extends AdvancedRenamePlanInput {
  expected_plan_hash: string
}

export interface AdvancedRenameDiagnostic {
  code: string
  message: string
  rule_id?: string
}

export type AdvancedRenamePreviewStatus =
  | 'ready'
  | 'unchanged'
  | 'excluded'
  | 'invalid'
  | 'conflict'
  | 'missing'

export interface AdvancedRenamePreviewItem {
  source_path: string
  original_name: string
  final_name: string
  kind: RemoteFileKind
  size: number
  modified_at?: string
  status: AdvancedRenamePreviewStatus
  diagnostics?: AdvancedRenameDiagnostic[]
}

export interface AdvancedRenamePreviewSummary {
  total: number
  changed: number
  unchanged: number
  excluded: number
  blocked: number
}

export interface AdvancedRenamePreview {
  plan_hash: string
  items: AdvancedRenamePreviewItem[]
  summary: AdvancedRenamePreviewSummary
}

export type AdvancedRenameExecutionStatus =
  | 'renamed'
  | 'unchanged'
  | 'excluded'
  | 'failed'
  | 'rolled_back'
  | 'uncertain'

export interface AdvancedRenameExecutionItem {
  source_path: string
  target_path: string
  status: AdvancedRenameExecutionStatus
  message?: string
}

export interface AdvancedRenameExecutionSummary {
  total: number
  renamed: number
  unchanged: number
  excluded: number
  rolled_back: number
  failed: number
  uncertain: number
}

export interface AdvancedRenameExecutionResult {
  plan_hash: string
  items: AdvancedRenameExecutionItem[]
  summary: AdvancedRenameExecutionSummary
  failure_reason?: string
  partial: boolean
  uncertain: boolean
}
