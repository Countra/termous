import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isExactCompletionItem,
  normalizeCompletionItem,
  splitCompletionLabel,
} from '../features/terminal/completionModel.ts'

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

test('Bash 原生命令来源与别名来源可合并展示', () => {
  const candidate = normalizeCompletionItem({
    id: 'alias:ll',
    kind: 'command',
    source: 'alias',
    label: 'll',
    insert_text: '',
    replace_start_utf16: 2,
    replace_end_utf16: 2,
    sources: ['alias', 'native'],
  })

  assert.deepEqual(candidate.sources, ['alias', 'native'])
  assert.equal(isExactCompletionItem(candidate), true)
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

test('候选标签区分已输入前缀、建议后缀和完整匹配', () => {
  const suggestion = normalizeCompletionItem({
    id: 'alias:lls',
    kind: 'command',
    source: 'alias',
    label: 'lls',
    insert_text: 's',
    replace_start_utf16: 2,
    replace_end_utf16: 2,
    sources: ['alias'],
  })
  assert.deepEqual(splitCompletionLabel(suggestion), {
    entered: 'll',
    suggestion: 's',
  })
  assert.equal(isExactCompletionItem(suggestion), false)

  const exact = {
    ...suggestion,
    id: 'alias:ll',
    label: 'll',
    insert_text: '',
  }
  assert.deepEqual(splitCompletionLabel(exact), {
    entered: 'll',
    suggestion: '',
  })
  assert.equal(isExactCompletionItem(exact), true)
})
