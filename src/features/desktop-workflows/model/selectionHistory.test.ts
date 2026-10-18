import assert from 'node:assert/strict'
import test from 'node:test'
import { initialSelectionHistory, selectionHistory } from './selectionHistory.ts'

const region = { x: 20, y: 30, width: 200, height: 100 }

test('一个手势中的预览不写入历史，取消恢复原区域，提交后可撤销和重做', () => {
  const start = initialSelectionHistory(region)
  let state = start
  for (let x = 21; x <= 50; x++) state = selectionHistory(state, { type: 'preview', value: { ...region, x } })
  assert.equal(state.past.length, 0)
  const cancelled = selectionHistory(state, { type: 'cancel' })
  assert.deepEqual(cancelled.present, region)
  assert.equal(cancelled.preview, undefined)
  assert.equal(cancelled.past.length, 0)
  state = selectionHistory(state, { type: 'commit', value: { ...region, x: 50 } })
  assert.equal(state.past.length, 1)
  const undone = selectionHistory(state, { type: 'undo' })
  assert.deepEqual(undone.present, region)
  assert.deepEqual(selectionHistory(undone, { type: 'redo' }), state)
})

test('空选区可作为历史状态，删除可撤销，新编辑截断重做分支，无变化不占用记录', () => {
  let state = selectionHistory(initialSelectionHistory(), { type: 'commit', value: region })
  state = selectionHistory(state, { type: 'commit' })
  assert.equal(state.present, undefined)
  state = selectionHistory(state, { type: 'undo' })
  assert.deepEqual(state.present, region)
  assert.equal(selectionHistory(state, { type: 'commit', value: { ...region } }), state)
  state = selectionHistory(state, { type: 'commit', value: { ...region, width: 300 } })
  assert.equal(state.future.length, 0)
  assert.equal(selectionHistory(state, { type: 'redo' }), state)
  state = selectionHistory(state, { type: 'undo' })
  state = selectionHistory(state, { type: 'undo' })
  assert.equal(state.present, undefined)
})

test('历史最多保留一百次修改，重置上下文后不能撤销到旧画面', () => {
  let state = initialSelectionHistory(region)
  for (let x = 21; x <= 250; x++) state = selectionHistory(state, { type: 'commit', value: { ...region, x } })
  assert.equal(state.past.length, 100)
  for (let index = 0; index < 110; index++) state = selectionHistory(state, { type: 'undo' })
  assert.equal(state.present?.x, 150)
  assert.equal(state.future.length, 100)
  state = selectionHistory(state, { type: 'reset' })
  assert.deepEqual(state, initialSelectionHistory())
  assert.equal(selectionHistory(state, { type: 'undo' }), state)
})
