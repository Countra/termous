import type {
  FileNameSearchCapability,
  FileNameSearchCaseMode,
  FileNameSearchEntryType,
  FileNameSearchHiddenMode,
  FileNameSearchIgnoreMode,
  FileNameSearchMatchMode,
  FileNameSearchMatchTarget,
  FileNameSearchRequest,
  FileNameSearchResult,
} from '#entities/file'
import { normalizeRemotePosixPath } from '#shared/path'
import type { GlobalFileSearchAdvancedFilters } from './types'

export const globalFileSearchResultLimit = 1_000
export const globalFileSearchQueryMaxBytes = 255
export const globalFileSearchMaxDepth = 256
export const globalFileSearchMaxExtensions = 16
export const globalFileSearchMaxExcludeGlobs = 16

export const globalFileSearchEntryTypes = [
  'all',
  'file',
  'directory',
] as const satisfies readonly FileNameSearchEntryType[]

export const globalFileSearchMatchModes = [
  'literal',
  'regex',
  'glob',
] as const satisfies readonly FileNameSearchMatchMode[]

export const globalFileSearchCaseModes = [
  'insensitive',
  'smart',
  'sensitive',
] as const satisfies readonly FileNameSearchCaseMode[]

export const globalFileSearchMatchTargets = [
  'name',
  'full_path',
] as const satisfies readonly FileNameSearchMatchTarget[]

export const globalFileSearchHiddenModes = [
  'include',
  'exclude',
] as const satisfies readonly FileNameSearchHiddenMode[]

export const globalFileSearchIgnoreModes = [
  'bypass',
  'respect',
] as const satisfies readonly FileNameSearchIgnoreMode[]

export function createDefaultGlobalFileSearchAdvancedFilters(): GlobalFileSearchAdvancedFilters {
  return {
    searchRoot: '/',
    matchMode: 'literal',
    caseMode: 'insensitive',
    matchTarget: 'name',
    hiddenMode: 'include',
    ignoreMode: 'bypass',
    maxDepth: 0,
    extensions: [],
    excludeGlobs: [],
    modifiedAfter: null,
    modifiedBefore: null,
    minSizeBytes: null,
    maxSizeBytes: null,
  }
}

export function countGlobalFileSearchAdvancedFilters(
  filters: GlobalFileSearchAdvancedFilters,
) {
  let count = 0
  const searchRoot = filters.searchRoot.trim()
  if (searchRoot !== '' && searchRoot !== '/') {
    count += 1
  }
  if (filters.matchMode !== 'literal') {
    count += 1
  }
  if (filters.caseMode !== 'insensitive') {
    count += 1
  }
  if (filters.matchTarget !== 'name') {
    count += 1
  }
  if (filters.hiddenMode !== 'include') {
    count += 1
  }
  if (filters.ignoreMode !== 'bypass') {
    count += 1
  }
  if (filters.maxDepth > 0) {
    count += 1
  }
  if (filters.extensions.length > 0) {
    count += 1
  }
  if (filters.excludeGlobs.length > 0) {
    count += 1
  }
  if (
    (filters.modifiedAfter?.trim().length ?? 0) > 0
    || (filters.modifiedBefore?.trim().length ?? 0) > 0
  ) {
    count += 1
  }
  if (filters.minSizeBytes !== null || filters.maxSizeBytes !== null) {
    count += 1
  }
  return count
}

export function areGlobalFileSearchAdvancedFiltersValid(
  filters: GlobalFileSearchAdvancedFilters,
  entryType: FileNameSearchEntryType,
) {
  const searchRoot = filters.searchRoot.trim()
  if (normalizeRemotePosixPath(searchRoot) === null) {
    return false
  }
  if (
    !Number.isInteger(filters.maxDepth)
    || filters.maxDepth < 0
    || filters.maxDepth > globalFileSearchMaxDepth
  ) {
    return false
  }
  if (
    filters.extensions.length > globalFileSearchMaxExtensions
    || filters.excludeGlobs.length > globalFileSearchMaxExcludeGlobs
  ) {
    return false
  }
  const modifiedAfter = filters.modifiedAfter ? Date.parse(filters.modifiedAfter) : null
  const modifiedBefore = filters.modifiedBefore ? Date.parse(filters.modifiedBefore) : null
  if (
    (modifiedAfter !== null && !Number.isFinite(modifiedAfter))
    || (modifiedBefore !== null && !Number.isFinite(modifiedBefore))
    || (
      modifiedAfter !== null
      && modifiedBefore !== null
      && modifiedAfter >= modifiedBefore
    )
  ) {
    return false
  }
  const hasSizeFilter = filters.minSizeBytes !== null || filters.maxSizeBytes !== null
  if (hasSizeFilter && entryType !== 'file') {
    return false
  }
  if (
    !isValidFileSizeBoundary(filters.minSizeBytes)
    || !isValidFileSizeBoundary(filters.maxSizeBytes)
    || (
      filters.minSizeBytes !== null
      && filters.maxSizeBytes !== null
      && filters.minSizeBytes > filters.maxSizeBytes
    )
  ) {
    return false
  }
  return true
}

function isValidFileSizeBoundary(value: number | null) {
  return value === null || (Number.isSafeInteger(value) && value >= 0)
}

interface GlobalFileSearchRequestOptions {
  connectionGeneration: number
  query: string
  entryType: FileNameSearchEntryType
  oneFileSystem: boolean
  filters: GlobalFileSearchAdvancedFilters
}

export function buildGlobalFileSearchRequest({
  connectionGeneration,
  query,
  entryType,
  oneFileSystem,
  filters,
}: GlobalFileSearchRequestOptions): FileNameSearchRequest {
  const modifiedAfter = filters.modifiedAfter?.trim()
  const modifiedBefore = filters.modifiedBefore?.trim()
  return {
    expected_connection_generation: connectionGeneration,
    query,
    entry_type: entryType,
    one_file_system: oneFileSystem,
    limit: globalFileSearchResultLimit,
    search_root: filters.searchRoot.trim() || '/',
    match_mode: filters.matchMode,
    case_mode: filters.caseMode,
    match_target: filters.matchTarget,
    hidden_mode: filters.hiddenMode,
    ignore_mode: filters.ignoreMode,
    max_depth: filters.maxDepth,
    extensions: [...filters.extensions],
    exclude_globs: [...filters.excludeGlobs],
    ...(modifiedAfter ? { modified_after: modifiedAfter } : {}),
    ...(modifiedBefore ? { modified_before: modifiedBefore } : {}),
    ...(filters.minSizeBytes !== null ? { min_size_bytes: filters.minSizeBytes } : {}),
    ...(filters.maxSizeBytes !== null ? { max_size_bytes: filters.maxSizeBytes } : {}),
  }
}

export function normalizeGlobalFileSearchQuery(value: string) {
  return value
}

export function canRunGlobalFileSearch(
  query: string,
  capability: FileNameSearchCapability | null,
) {
  return query.trim().length > 0
    && new TextEncoder().encode(query).byteLength <= globalFileSearchQueryMaxBytes
    && capability?.status === 'ready'
}

export function isCurrentGlobalFileSearchResult(
  result: FileNameSearchResult,
  connectionGeneration: number,
) {
  return result.connection_generation === connectionGeneration
}

export function globalFileSearchInstallCommands(capability: FileNameSearchCapability | null) {
  const plan = capability?.install_plan
  if (!plan) {
    return []
  }
  return (plan.manual_commands.length > 0
    ? plan.manual_commands
    : plan.commands.map((item) => item.command))
    .filter((command) => command.trim().length > 0)
}
