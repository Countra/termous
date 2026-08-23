import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileNameSearchCapability } from '#entities/file'
import {
  areGlobalFileSearchAdvancedFiltersValid,
  buildGlobalFileSearchRequest,
  canRunGlobalFileSearch,
  countGlobalFileSearchAdvancedFilters,
  createDefaultGlobalFileSearchAdvancedFilters,
  globalFileSearchInstallCommands,
  globalFileSearchQueryMaxBytes,
  normalizeGlobalFileSearchQuery,
} from './globalFileSearchModel.ts'

const readyCapability: FileNameSearchCapability = {
  status: 'ready',
  executable: 'fd',
  version: '10.2.0',
  minimum_version: '8.0.0',
  privilege: 'none',
  connection_generation: 3,
  install_available: false,
}

test('名称查询保留有意义的前后空格，仅拒绝全空白输入', () => {
  assert.equal(normalizeGlobalFileSearchQuery(' release notes '), ' release notes ')
  assert.equal(canRunGlobalFileSearch(' release notes ', readyCapability), true)
  assert.equal(canRunGlobalFileSearch('   ', readyCapability), false)
})

test('查询超过 UTF-8 字节边界时保留原文但禁止提交', () => {
  const value = `${'a'.repeat(globalFileSearchQueryMaxBytes - 2)}中tail`
  const normalized = normalizeGlobalFileSearchQuery(value)

  assert.equal(normalized, value)
  assert.equal(canRunGlobalFileSearch(normalized, readyCapability), false)
  assert.equal(normalized.includes('\uFFFD'), false)
})

test('复制命令优先使用后端手工命令且不自行拼装包管理器参数', () => {
  const capability: FileNameSearchCapability = {
    status: 'missing',
    minimum_version: '8.0.0',
    privilege: 'sudo',
    connection_generation: 3,
    install_available: true,
    install_plan: {
      automatic: true,
      privilege: 'sudo',
      plan_hash: 'plan-1',
      commands: [{ id: 'install', title: 'Install', command: 'sudo -n apt install fd-find' }],
      manual_commands: ['sudo apt install fd-find'],
      warnings: [],
    },
  }

  assert.deepEqual(globalFileSearchInstallCommands(capability), ['sudo apt install fd-find'])
})

test('高级筛选默认值保持原有全局字面搜索语义', () => {
  const filters = createDefaultGlobalFileSearchAdvancedFilters()

  assert.deepEqual(filters, {
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
  })
  assert.equal(countGlobalFileSearchAdvancedFilters(filters), 0)
  assert.equal(countGlobalFileSearchAdvancedFilters({ ...filters, modifiedAfter: '' }), 0)
  assert.deepEqual(buildGlobalFileSearchRequest({
    connectionGeneration: 3,
    query: ' release ',
    entryType: 'all',
    oneFileSystem: false,
    filters,
  }), {
    expected_connection_generation: 3,
    query: ' release ',
    entry_type: 'all',
    one_file_system: false,
    limit: 1_000,
    search_root: '/',
    match_mode: 'literal',
    case_mode: 'insensitive',
    match_target: 'name',
    hidden_mode: 'include',
    ignore_mode: 'bypass',
    max_depth: 0,
    extensions: [],
    exclude_globs: [],
  })
})

test('高级筛选计数按筛选维度聚合范围和列表参数', () => {
  const filters = {
    ...createDefaultGlobalFileSearchAdvancedFilters(),
    searchRoot: '/srv',
    matchMode: 'regex' as const,
    caseMode: 'smart' as const,
    matchTarget: 'full_path' as const,
    hiddenMode: 'exclude' as const,
    ignoreMode: 'respect' as const,
    maxDepth: 8,
    extensions: ['go', 'ts'],
    excludeGlobs: ['**/vendor/**', '**/node_modules/**'],
    modifiedAfter: '2026-08-01T00:00:00Z',
    modifiedBefore: '2026-08-20T00:00:00Z',
    minSizeBytes: 1_024,
    maxSizeBytes: 8_192,
  }

  assert.equal(countGlobalFileSearchAdvancedFilters(filters), 11)
  assert.deepEqual(buildGlobalFileSearchRequest({
    connectionGeneration: 7,
    query: 'report.*',
    entryType: 'file',
    oneFileSystem: true,
    filters,
  }), {
    expected_connection_generation: 7,
    query: 'report.*',
    entry_type: 'file',
    one_file_system: true,
    limit: 1_000,
    search_root: '/srv',
    match_mode: 'regex',
    case_mode: 'smart',
    match_target: 'full_path',
    hidden_mode: 'exclude',
    ignore_mode: 'respect',
    max_depth: 8,
    extensions: ['go', 'ts'],
    exclude_globs: ['**/vendor/**', '**/node_modules/**'],
    modified_after: '2026-08-01T00:00:00Z',
    modified_before: '2026-08-20T00:00:00Z',
    min_size_bytes: 1_024,
    max_size_bytes: 8_192,
  })
})

test('高级筛选在目录、时间或大小范围无效时阻止提交', () => {
  const filters = createDefaultGlobalFileSearchAdvancedFilters()

  assert.equal(areGlobalFileSearchAdvancedFiltersValid(filters, 'all'), true)
  assert.equal(areGlobalFileSearchAdvancedFiltersValid({
    ...filters,
    searchRoot: '',
  }, 'all'), false)
  assert.equal(areGlobalFileSearchAdvancedFiltersValid({
    ...filters,
    searchRoot: '/srv\u0000private',
  }, 'all'), false)
  assert.equal(areGlobalFileSearchAdvancedFiltersValid({
    ...filters,
    maxDepth: 1.5,
  }, 'all'), false)
  assert.equal(areGlobalFileSearchAdvancedFiltersValid({
    ...filters,
    modifiedAfter: '2026-08-20T00:00:00Z',
    modifiedBefore: '2026-08-20T00:00:00Z',
  }, 'all'), false)
  assert.equal(areGlobalFileSearchAdvancedFiltersValid({
    ...filters,
    minSizeBytes: 1024,
    maxSizeBytes: 512,
  }, 'file'), false)
  assert.equal(areGlobalFileSearchAdvancedFiltersValid({
    ...filters,
    minSizeBytes: 1024,
  }, 'all'), false)
  assert.equal(areGlobalFileSearchAdvancedFiltersValid({
    ...filters,
    minSizeBytes: Number.POSITIVE_INFINITY,
  }, 'file'), false)
})
