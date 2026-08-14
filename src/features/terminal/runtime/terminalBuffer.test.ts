import assert from 'node:assert/strict'
import test from 'node:test'
import { clearTerminalBuffer } from './terminalBuffer.ts'
import type { TerminalEntry } from './terminalRuntimeTypes.ts'

test('清屏只处理存活终端并同步清理选区与查找状态', () => {
  const events: string[] = []
  const entry = createEntry(events)

  assert.equal(clearTerminalBuffer(entry), true)
  assert.deepEqual(events, ['buffer-clear', 'search-clear', 'selection-clear'])
  assert.deepEqual(entry.searchResult, {
    found: false,
    resultIndex: -1,
    resultCount: 0,
  })
  assert.equal(entry.searchDecorationKey, '')
  assert.equal(entry.completionPromptAnchor?.cursorY, 0)
})

test('终端缺失、已释放或核心清屏异常时不提交附属状态', () => {
  const events: string[] = []
  const disposed = createEntry(events)
  disposed.disposed = true

  assert.equal(clearTerminalBuffer(undefined), false)
  assert.equal(clearTerminalBuffer(disposed), false)
  assert.deepEqual(events, [])

  const failed = createEntry(events, { failClear: true })
  assert.equal(clearTerminalBuffer(failed), false)
  assert.deepEqual(events, ['buffer-clear'])
  assert.equal(failed.searchResult.found, true)
  assert.equal(failed.searchDecorationKey, 'search-key')
  assert.equal(failed.completionPromptAnchor?.cursorY, 12)
})

test('附属清理异常不回滚已完成的清屏与状态重置', () => {
  const events: string[] = []
  const entry = createEntry(events, { failSearchCleanup: true, failSelectionCleanup: true })

  assert.equal(clearTerminalBuffer(entry), true)
  assert.deepEqual(events, ['buffer-clear', 'search-clear', 'selection-clear'])
  assert.equal(entry.searchResult.found, false)
  assert.equal(entry.searchDecorationKey, '')
})

test('跨行提示符锚点在清屏后失效', () => {
  const events: string[] = []
  const entry = createEntry(events)
  if (entry.completionPromptAnchor) {
    entry.completionPromptAnchor.cursorY = 11
  }

  assert.equal(clearTerminalBuffer(entry), true)
  assert.equal(entry.completionPromptAnchor, null)
})

function createEntry(
  events: string[],
  options: {
    failClear?: boolean
    failSearchCleanup?: boolean
    failSelectionCleanup?: boolean
  } = {},
): TerminalEntry {
  const activeBuffer = {
    type: 'normal',
    cursorY: 12,
  }
  return {
    disposed: false,
    completionPromptAnchor: {
      sourceGeneration: 1,
      shellId: 'bash',
      promptGeneration: 2,
      inputEpoch: 3,
      cursorX: 4,
      cursorY: 12,
    },
    searchDecorationKey: 'search-key',
    searchResult: {
      found: true,
      resultIndex: 1,
      resultCount: 2,
    },
    search: {
      clearDecorations: () => {
        events.push('search-clear')
        if (options.failSearchCleanup) {
          throw new Error('search cleanup failed')
        }
      },
    },
    terminal: {
      buffer: { active: activeBuffer },
      clearSelection: () => {
        events.push('selection-clear')
        if (options.failSelectionCleanup) {
          throw new Error('selection cleanup failed')
        }
      },
      clear: () => {
        events.push('buffer-clear')
        if (options.failClear) {
          throw new Error('clear failed')
        }
        activeBuffer.cursorY = 0
      },
    },
  } as unknown as TerminalEntry
}
