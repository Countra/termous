import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeTerminalCompletionPosition,
  estimateTerminalCompletionPopupHeight,
  isPredictableTerminalCompletionText,
  predictTerminalCompletionCursor,
  TERMINAL_COMPLETION_MAX_VISIBLE_ITEMS,
} from './terminalCompletionPosition.ts'

const paneRect = { left: 100, top: 50, width: 800, height: 600 }
const screenRect = { left: 112, top: 62, width: 760, height: 560 }

test('候选层优先显示在光标下方并换算为 pane 内坐标', () => {
  assert.deepEqual(computeTerminalCompletionPosition({
    paneRect,
    screenRect,
    cursorX: 10,
    cursorY: 4,
    cellWidth: 8,
    cellHeight: 20,
    popupWidth: 300,
    popupHeight: 202,
  }), {
    left: 92,
    top: 118,
    maxWidth: 784,
    maxHeight: 202,
    placement: 'below',
  })
})

test('下方空间不足时翻转到光标上方', () => {
  const result = computeTerminalCompletionPosition({
    paneRect,
    screenRect,
    cursorX: 5,
    cursorY: 24,
    cellWidth: 8,
    cellHeight: 20,
    popupWidth: 300,
    popupHeight: 202,
  })

  assert.equal(result?.placement, 'above')
  assert.equal(result?.top, 284)
})

test('靠近右侧时限制水平位置且不超出 pane', () => {
  const result = computeTerminalCompletionPosition({
    paneRect,
    screenRect,
    cursorX: 95,
    cursorY: 2,
    cellWidth: 8,
    cellHeight: 20,
    popupWidth: 300,
    popupHeight: 106,
  })

  assert.equal(result?.left, 492)
  assert.equal(result?.maxWidth, 784)
})

test('上下均放不下时选择空间较大的一侧并限制可见高度', () => {
  const result = computeTerminalCompletionPosition({
    paneRect: { left: 0, top: 0, width: 420, height: 220 },
    screenRect: { left: 10, top: 10, width: 400, height: 200 },
    cursorX: 1,
    cursorY: 4,
    cellWidth: 8,
    cellHeight: 20,
    popupWidth: 300,
    popupHeight: 394,
  })

  assert.deepEqual(result, {
    left: 18,
    top: 116,
    maxWidth: 404,
    maxHeight: 96,
    placement: 'below',
  })
})

test('过窄或非法几何信息不创建不可用浮层', () => {
  assert.equal(computeTerminalCompletionPosition({
    paneRect: { left: 0, top: 0, width: 10, height: 10 },
    screenRect,
    cursorX: 0,
    cursorY: 0,
    cellWidth: 8,
    cellHeight: 20,
    popupWidth: 300,
    popupHeight: 100,
  }), null)
  assert.equal(computeTerminalCompletionPosition({
    paneRect,
    screenRect,
    cursorX: Number.NaN,
    cursorY: 0,
    cellWidth: 8,
    cellHeight: 20,
    popupWidth: 300,
    popupHeight: 100,
  }), null)
})

test('高度估算最多计算八条候选且拒绝负数量', () => {
  assert.equal(estimateTerminalCompletionPopupHeight(-2), 0)
  assert.equal(estimateTerminalCompletionPopupHeight(Number.NaN), 0)
  assert.equal(estimateTerminalCompletionPopupHeight(3), 171)
  assert.equal(estimateTerminalCompletionPopupHeight(3, false), 142)
  assert.equal(estimateTerminalCompletionPopupHeight(20), 391)
  assert.equal(TERMINAL_COMPLETION_MAX_VISIBLE_ITEMS, 8)
})

test('高延迟下按提示符锚点预测 ASCII 输入光标', () => {
  assert.deepEqual(predictTerminalCompletionCursor({
    anchorX: 12,
    anchorY: 4,
    columns: 80,
    rows: 24,
    line: 'docker res',
    cursorUtf16: 10,
  }), {
    cursorX: 22,
    cursorY: 4,
  })
  assert.deepEqual(predictTerminalCompletionCursor({
    anchorX: 78,
    anchorY: 4,
    columns: 80,
    rows: 24,
    line: 'abcd',
    cursorUtf16: 4,
  }), {
    cursorX: 2,
    cursorY: 5,
  })
  assert.deepEqual(predictTerminalCompletionCursor({
    anchorX: 79,
    anchorY: 4,
    columns: 80,
    rows: 24,
    line: 'a',
    cursorUtf16: 1,
  }), {
    cursorX: 80,
    cursorY: 4,
  })
  assert.deepEqual(predictTerminalCompletionCursor({
    anchorX: 78,
    anchorY: 4,
    columns: 80,
    rows: 24,
    line: 'ab',
    cursorUtf16: 2,
  }), {
    cursorX: 80,
    cursorY: 4,
  })
  assert.deepEqual(predictTerminalCompletionCursor({
    anchorX: 78,
    anchorY: 4,
    columns: 80,
    rows: 24,
    line: 'abc',
    cursorUtf16: 3,
  }), {
    cursorX: 1,
    cursorY: 5,
  })
})

test('复杂字符或越出可视区时不进行光标预测', () => {
  assert.equal(isPredictableTerminalCompletionText('docker compose'), true)
  assert.equal(isPredictableTerminalCompletionText('你好'), false)
  assert.equal(isPredictableTerminalCompletionText('🙂'), false)
  assert.equal(predictTerminalCompletionCursor({
    anchorX: 12,
    anchorY: 4,
    columns: 80,
    rows: 24,
    line: '你好',
    cursorUtf16: 2,
  }), null)
  assert.equal(predictTerminalCompletionCursor({
    anchorX: 79,
    anchorY: 23,
    columns: 80,
    rows: 24,
    line: 'ab',
    cursorUtf16: 2,
  }), null)
})
