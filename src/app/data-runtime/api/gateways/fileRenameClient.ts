import type { AppConfig } from '#common/contracts'
import type {
  AdvancedRenameExecuteInput,
  AdvancedRenameOrder,
  AdvancedRenamePlanInput,
  AdvancedRenamePreview,
  AdvancedRenameRule,
  AdvancedRenameRuleCondition,
  FileOperationTask,
  FileRenamePreset,
  FileRenamePresetInput,
} from '#entities/file'
import { TermousApiTransport } from '#shared/api'
import { normalizeArray } from './responseNormalizers'

export class FileRenameClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  fileRenamePresets() {
    return this.request<FileRenamePreset[]>('/api/v1/file-rename-presets')
      .then(normalizeArray)
      .then((items) => items.map(normalizeFileRenamePreset))
  }

  createFileRenamePreset(input: FileRenamePresetInput) {
    return this.request<FileRenamePreset>('/api/v1/file-rename-presets', {
      method: 'POST',
      body: input,
    }).then(normalizeFileRenamePreset)
  }

  updateFileRenamePreset(id: string, expectedUpdatedAt: string, input: FileRenamePresetInput) {
    return this.request<FileRenamePreset>(`/api/v1/file-rename-presets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...input, expected_updated_at: expectedUpdatedAt },
    }).then(normalizeFileRenamePreset)
  }

  deleteFileRenamePreset(id: string, expectedUpdatedAt: string) {
    return this.request<void>(`/api/v1/file-rename-presets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: { expected_updated_at: expectedUpdatedAt },
    })
  }

  previewFileSessionBatchRename(
    fileSessionId: string,
    input: AdvancedRenamePlanInput,
    signal?: AbortSignal,
  ) {
    return this.request<AdvancedRenamePreview>(
      `/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/batch-rename/preview`,
      { method: 'POST', body: input, signal },
    )
  }

  createFileSessionBatchRename(fileSessionId: string, input: AdvancedRenameExecuteInput) {
    return this.request<FileOperationTask>(
      `/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/batch-rename`,
      { method: 'POST', body: input },
    )
  }
}

function normalizeFileRenamePreset(value: FileRenamePreset): FileRenamePreset {
  return {
    ...value,
    description: typeof value.description === 'string' ? value.description : '',
    rules: normalizeArray(value.rules).map(normalizeFileRenameRule),
    order: normalizeFileRenameOrder(value.order),
    variable_definitions: normalizeArray(value.variable_definitions).map((definition) => ({
      ...definition,
      name: stringValue(definition.name),
      label: stringValue(definition.label),
      description: typeof definition.description === 'string' ? definition.description : '',
      default_value: stringValue(definition.default_value),
      required: definition.required === true,
    })),
  }
}

function normalizeFileRenameOrder(value?: AdvancedRenameOrder): AdvancedRenameOrder {
  return {
    by: value?.by === 'name' || value?.by === 'modified' || value?.by === 'size' || value?.by === 'kind'
      ? value.by
      : 'selection',
    direction: value?.direction === 'desc' ? 'desc' : 'asc',
  }
}

function normalizeFileRenameRule(value: AdvancedRenameRule): AdvancedRenameRule {
  const config = (value.config ?? {}) as unknown as Record<string, unknown>
  const target = normalizeFileRenameTarget(config.target)
  const position = normalizeFileRenamePosition(config.position)
  const base = {
    enabled: value.enabled === true,
    condition: normalizeFileRenameCondition(value.condition),
  }
  switch (value.kind) {
    case 'template':
      return { ...value, ...base, config: { template: stringValue(config.template) } }
    case 'insert':
      return {
        ...value,
        ...base,
        config: {
          text: stringValue(config.text),
          position,
          index: optionalNumber(config.index),
          target,
        },
      }
    case 'replace':
      return {
        ...value,
        ...base,
        config: {
          search: stringValue(config.search),
          replacement: stringValue(config.replacement),
          regex: config.regex === true,
          replace_all: config.replace_all === true,
          case_sensitive: config.case_sensitive === true,
          target,
        },
      }
    case 'slice':
      return {
        ...value,
        ...base,
        config: {
          mode: config.mode === 'keep' ? 'keep' : 'remove',
          start: numberValue(config.start),
          length: optionalNumber(config.length),
          from_end: config.from_end === true,
          target,
        },
      }
    case 'case':
      return {
        ...value,
        ...base,
        config: {
          mode: config.mode === 'upper' || config.mode === 'title' ? config.mode : 'lower',
          target,
        },
      }
    case 'cleanup':
      return {
        ...value,
        ...base,
        config: {
          trim_whitespace: config.trim_whitespace === true,
          separator: typeof config.separator === 'string' ? config.separator : undefined,
          collapse_separator: config.collapse_separator === true,
          target,
        },
      }
    case 'sequence':
      return {
        ...value,
        ...base,
        config: {
          position,
          index: optionalNumber(config.index),
          start: numberValue(config.start),
          step: numberValue(config.step),
          width: numberValue(config.width),
          target,
        },
      }
    case 'extension':
      return {
        ...value,
        ...base,
        config: {
          mode: config.mode === 'set' || config.mode === 'lower' || config.mode === 'upper'
            ? config.mode
            : 'remove',
          value: typeof config.value === 'string' ? config.value : undefined,
        },
      }
  }
}

function normalizeFileRenameCondition(
  value: AdvancedRenameRuleCondition | undefined,
): AdvancedRenameRuleCondition | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const originalName = value.original_name && typeof value.original_name === 'object'
    ? {
        pattern: stringValue(value.original_name.pattern),
        regex: value.original_name.regex === true,
        case_sensitive: value.original_name.case_sensitive === true,
      }
    : undefined
  return {
    kinds: normalizeArray(value.kinds).filter((kind) => (
      kind === 'file' || kind === 'directory' || kind === 'symlink'
    )),
    original_name: originalName,
    extensions: normalizeArray(value.extensions).filter((extension): extension is string => (
      typeof extension === 'string'
    )),
  }
}

function normalizeFileRenameTarget(value: unknown): 'name' | 'stem' | 'extension' {
  return value === 'stem' || value === 'extension' ? value : 'name'
}

function normalizeFileRenamePosition(value: unknown): 'prefix' | 'suffix' | 'index' {
  return value === 'suffix' || value === 'index' ? value : 'prefix'
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
