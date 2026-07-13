import type {
  DataPortabilityDatasetKey,
  DataPortabilityImport,
  DataPortabilityPlanItem,
  DataPortabilityProgress,
  DataPortabilityRestorePlan,
  DataPortabilitySummary,
} from '../../types/domain'

export const portabilityDatasets: DataPortabilityDatasetKey[] = [
  'settings',
  'host_groups',
  'host_icons',
  'credentials',
  'hosts',
  'known_hosts',
  'terminal_fonts',
  'code_snippet_groups',
  'code_snippets',
  'file_bookmark_groups',
  'file_bookmarks',
  'local_path_mappings',
  'forward_profiles',
  'firewall_disabled_rules',
]

export function normalizePortabilitySummary(value: DataPortabilitySummary): DataPortabilitySummary {
  return {
    ...value,
    datasets: Array.isArray(value.datasets) ? value.datasets : [],
  }
}

export function normalizePortabilityImport(value: DataPortabilityImport): DataPortabilityImport {
  return {
    ...normalizePortabilitySummary(value),
    import_id: value.import_id,
    source_app_version: value.source_app_version,
    created_at: value.created_at,
    expires_at: value.expires_at,
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
  }
}

export function normalizePortabilityPlan(value: DataPortabilityRestorePlan): DataPortabilityRestorePlan {
  return {
    ...value,
    items: Array.isArray(value.items) ? value.items : [],
    summary: {
      ...value.summary,
      by_status: value.summary?.by_status ?? {},
      by_dataset: value.summary?.by_dataset ?? {},
    },
  }
}

export function formatPortabilityBytes(value?: number) {
  if (!Number.isFinite(value) || !value || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const size = value / 1024 ** index
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

export function portabilityProgressPercent(progress?: DataPortabilityProgress | null) {
  if (!progress) return 0
  if (progress.phase === 'complete') return 100
  if (!progress.total_bytes || !progress.transferred_bytes) return progress.phase === 'finalizing' ? 96 : 18
  return Math.min(95, Math.max(2, Math.round((progress.transferred_bytes / progress.total_bytes) * 92)))
}

export function itemSelectionKey(item: DataPortabilityPlanItem) {
  return `${item.reference.dataset}:${item.reference.id}`
}

export function formatDifferenceValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  try {
    const encoded = JSON.stringify(value)
    return encoded.length > 96 ? `${encoded.slice(0, 93)}...` : encoded
  } catch {
    return '—'
  }
}
