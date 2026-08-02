import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCompletionItem } from '../features/terminal/completionModel.ts'

test('候选来源缺失时使用主来源安全补齐', () => {
  const candidate = normalizeCompletionItem({
    id: 'history:1',
    kind: 'command',
    source: 'history',
    label: 'lscpu',
    insert_text: 'scpu',
    replace_start_utf16: 1,
    replace_end_utf16: 1,
  } as Parameters<typeof normalizeCompletionItem>[0])

  assert.deepEqual(candidate.sources, ['history'])
})

test('候选来源集合去重并保留未来来源标识', () => {
  const candidate = normalizeCompletionItem({
    id: 'alias:1',
    kind: 'command',
    source: 'alias',
    label: 'll',
    insert_text: 'l',
    replace_start_utf16: 1,
    replace_end_utf16: 1,
    sources: ['snippet', 'alias', 'unknown', 'snippet'],
  } as unknown as Parameters<typeof normalizeCompletionItem>[0])

  assert.deepEqual(candidate.sources, ['alias', 'snippet', 'unknown'])
})

test('候选来源拒绝不安全或超长的协议标识', () => {
  assert.throws(() => normalizeCompletionItem({
    id: 'invalid:1',
    kind: 'command',
    source: 'Invalid Source',
    label: 'bad',
    insert_text: 'bad',
    replace_start_utf16: 0,
    replace_end_utf16: 0,
    sources: [],
  }), /Invalid completion source/)
})
