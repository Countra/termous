import assert from 'node:assert/strict'
import test from 'node:test'
import {
  replaceCodeSnippet,
  sortCodeSnippetGroups,
  upsertCodeSnippet,
  upsertCodeSnippetGroup,
} from './snippetCollection.ts'
import type { CodeSnippet, CodeSnippetGroup } from './types.ts'

function createSnippet(id: string, overrides: Partial<CodeSnippet> = {}): CodeSnippet {
  return {
    id,
    group_id: '',
    name: id,
    command: 'echo ready',
    tags: [],
    shell: 'any',
    favorite: false,
    use_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function createGroup(id: string, sortOrder: number, name = id): CodeSnippetGroup {
  return {
    id,
    name,
    sort_order: sortOrder,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

test('命令片段新增和更新后保持收藏、名称、时间与 ID 排序', () => {
  const snippets = [
    createSnippet('later', { name: 'Beta', created_at: '2026-01-02T00:00:00Z' }),
    createSnippet('favorite', { name: 'Zulu', favorite: true }),
    createSnippet('zeta-tie', { name: 'Beta' }),
  ]

  const inserted = upsertCodeSnippet(snippets, createSnippet('alpha-tie', { name: 'Beta' }))
  assert.deepEqual(inserted.map((snippet) => snippet.id), ['favorite', 'alpha-tie', 'zeta-tie', 'later'])
  assert.deepEqual(snippets.map((snippet) => snippet.id), ['later', 'favorite', 'zeta-tie'])

  const replaced = replaceCodeSnippet(inserted, createSnippet('later', { name: 'Alpha', use_count: 2 }))
  assert.deepEqual(replaced.map((snippet) => snippet.id), ['favorite', 'alpha-tie', 'zeta-tie', 'later'])
  assert.equal(replaced[3].use_count, 2)
})

test('命令片段分组按顺序、名称和 ID 排序并保持输入不变', () => {
  const groups = [createGroup('beta', 2), createGroup('zulu', 1, 'Same')]

  const sorted = sortCodeSnippetGroups(groups)
  assert.deepEqual(sorted.map((group) => group.id), ['zulu', 'beta'])
  assert.deepEqual(groups.map((group) => group.id), ['beta', 'zulu'])

  const inserted = upsertCodeSnippetGroup(sorted, createGroup('alpha', 1, 'Same'))
  assert.deepEqual(inserted.map((group) => group.id), ['alpha', 'zulu', 'beta'])

  const updated = upsertCodeSnippetGroup(inserted, createGroup('beta', 0))
  assert.deepEqual(updated.map((group) => group.id), ['beta', 'alpha', 'zulu'])
})
