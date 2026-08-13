import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmptyTerminalSearchResult,
  isValidTerminalSearchRegex,
  normalizeTerminalSearchEventResult,
  normalizeTerminalSearchSeed,
} from './terminalSearch.ts'

test('终端搜索种子只接受有界单行文本', () => {
  assert.equal(normalizeTerminalSearchSeed('needle'), 'needle')
  assert.equal(normalizeTerminalSearchSeed('one\ntwo'), '')
  assert.equal(normalizeTerminalSearchSeed('   '), '')
  assert.equal(normalizeTerminalSearchSeed('x'.repeat(2049)), '')
})

test('终端搜索结果稳定归一空结果和事件计数', () => {
  assert.deepEqual(createEmptyTerminalSearchResult(), {
    found: false,
    resultIndex: -1,
    resultCount: 0,
  })
  assert.deepEqual(normalizeTerminalSearchEventResult(1, 3), {
    found: true,
    resultIndex: 1,
    resultCount: 3,
  })
  assert.deepEqual(normalizeTerminalSearchEventResult(-1, 3), {
    found: false,
    resultIndex: -1,
    resultCount: 3,
  })
  assert.deepEqual(normalizeTerminalSearchEventResult(0, 0), createEmptyTerminalSearchResult())
})

test('终端搜索正则校验保持大小写选项并拒绝非法表达式', () => {
  assert.equal(isValidTerminalSearchRegex('term(?:ous)?', false), true)
  assert.equal(isValidTerminalSearchRegex('[A-Z]+', true), true)
  assert.equal(isValidTerminalSearchRegex('[', false), false)
})
