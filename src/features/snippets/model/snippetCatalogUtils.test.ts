import assert from 'node:assert/strict'
import test from 'node:test'
import type { CodeSnippet } from '#entities/snippet'
import { buildSnippetTags, filterSnippets } from './snippetCatalogUtils.ts'

function snippet(id: string, overrides: Partial<CodeSnippet> = {}): CodeSnippet {
  return {
    id,
    group_id: '',
    name: `Snippet ${id}`,
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

test('命令片段筛选组合使用 AND 语义', () => {
  const snippets = [
    snippet('deploy', {
      group_id: 'group-production',
      name: 'Deploy API',
      description: 'East China production rollout',
      command: 'systemctl restart api',
      tags: ['Production', 'API'],
      shell: 'bash',
      favorite: true,
    }),
    snippet('inspect', {
      name: 'Inspect worker',
      tags: ['Production'],
    }),
    snippet('missing-query-token', {
      group_id: 'group-production',
      name: 'Deploy API',
      description: 'production rollout',
      tags: ['Production', 'API'],
      shell: 'bash',
      favorite: true,
    }),
    snippet('missing-tag', {
      group_id: 'group-production',
      name: 'Deploy API East',
      tags: ['Production'],
      shell: 'bash',
      favorite: true,
    }),
    snippet('not-favorite', {
      group_id: 'group-production',
      name: 'Deploy API East',
      tags: ['Production', 'API'],
      shell: 'bash',
    }),
    snippet('wrong-group', {
      group_id: 'group-staging',
      name: 'Deploy API East',
      tags: ['Production', 'API'],
      shell: 'bash',
      favorite: true,
    }),
  ]

  const filtered = filterSnippets(snippets, {
    filter: 'favorites',
    query: 'deploy east bash',
    selectedTags: ['api', 'production'],
    groupId: 'group-production',
  })

  assert.deepEqual(filtered.map((item) => item.id), ['deploy'])
  assert.deepEqual(filterSnippets(snippets, {
    filter: 'all',
    query: '',
    selectedTags: [],
    groupId: '__ungrouped__',
  }).map((item) => item.id), ['inspect'])
})

test('标签统计忽略同一片段内大小写重复项', () => {
  const summaries = buildSnippetTags([
    snippet('first', { tags: ['Production', 'production', 'API'] }),
    snippet('second', { tags: ['production'] }),
  ])

  assert.deepEqual(summaries, [
    { key: 'api', label: 'API', count: 1 },
    { key: 'production', label: 'Production', count: 2 },
  ])
})
