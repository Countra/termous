import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTerminalCompletionData,
  applyTerminalCompletionPaste,
  applyTerminalCompletionProgrammaticInput,
  beginTerminalCompletionComposition,
  createTerminalCompletionInputState,
  endTerminalCompletionComposition,
  resetTerminalCompletionInput,
} from '../features/terminal/terminalCompletionInput.ts'

function trustedInput() {
  return resetTerminalCompletionInput(createTerminalCompletionInputState(), 'trusted')
}

test('可信输入支持单行文本和基础光标编辑', () => {
  let state = trustedInput()
  state = applyTerminalCompletionData(state, 'echo 世界').state
  assert.equal(state.line, 'echo 世界')
  assert.equal(state.cursorUtf16, 'echo 世界'.length)

  state = applyTerminalCompletionData(state, '\x1b[D').state
  state = applyTerminalCompletionData(state, '\x7f').state
  assert.equal(state.line, 'echo 界')
  assert.equal(state.cursorUtf16, 'echo '.length)

  state = applyTerminalCompletionData(state, '\x1b[H').state
  state = applyTerminalCompletionData(state, '$').state
  assert.equal(state.line, '$echo 界')
  state = applyTerminalCompletionData(state, '\x1b[F').state
  assert.equal(state.cursorUtf16, state.line.length)
})

test('退格和删除不会拆开 UTF-16 代理对', () => {
  let state = trustedInput()
  state = applyTerminalCompletionData(state, 'a😀b').state
  state = applyTerminalCompletionData(state, '\x1b[D').state
  state = applyTerminalCompletionData(state, '\x7f').state
  assert.equal(state.line, 'ab')
  assert.equal(state.cursorUtf16, 1)

  state = applyTerminalCompletionData(state, '😀').state
  state = applyTerminalCompletionData(state, '\x1b[D').state
  state = applyTerminalCompletionData(state, '\x1b[3~').state
  assert.equal(state.line, 'ab')
})

test('单行粘贴可追踪，多行与控制字符使模型失信', () => {
  let state = trustedInput()
  let update = applyTerminalCompletionPaste(state, 'cd /srv/app')
  assert.equal(update.disposition, 'tracked')
  assert.equal(update.state.line, 'cd /srv/app')

  update = applyTerminalCompletionPaste(update.state, 'first\nsecond')
  assert.equal(update.disposition, 'invalidated')
  assert.equal(update.state.trust, 'uncertain')
  assert.equal(update.state.line, '')

  state = trustedInput()
  update = applyTerminalCompletionData(state, '\x1b[200~目录 一\x1b[201~')
  assert.equal(update.disposition, 'tracked')
  assert.equal(update.state.line, '目录 一')
})

test('Enter、Tab、Ctrl+C 和未知序列必须等待下一提示符恢复', () => {
  for (const data of ['\r', '\t', '\x03', '\x1b[A', '\x1b[999~']) {
    const update = applyTerminalCompletionData(trustedInput(), data)
    assert.equal(update.disposition, 'invalidated', JSON.stringify(data))
    assert.equal(update.state.trust, 'uncertain')
  }
})

test('IME 组合期间不追踪输入，结束后由实际 onData 恢复追踪', () => {
  let state = beginTerminalCompletionComposition(trustedInput())
  assert.equal(state.composing, true)
  const duringComposition = applyTerminalCompletionData(state, '中')
  assert.equal(duringComposition.disposition, 'invalidated')

  state = endTerminalCompletionComposition(beginTerminalCompletionComposition(trustedInput()))
  const committed = applyTerminalCompletionData(state, '中')
  assert.equal(committed.disposition, 'tracked')
  assert.equal(committed.state.line, '中')
})

test('程序化单行插入可追踪，带执行语义时直接失信', () => {
  const inserted = applyTerminalCompletionProgrammaticInput(
    trustedInput(),
    'git status',
    false,
  )
  assert.equal(inserted.state.line, 'git status')

  const executed = applyTerminalCompletionProgrammaticInput(
    inserted.state,
    'pwd',
    true,
  )
  assert.equal(executed.disposition, 'invalidated')
  assert.equal(executed.state.trust, 'uncertain')
})
