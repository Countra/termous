import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerminalSettings } from '#common/contracts'
import type { CommandDispatchOutputSnapshot } from './commandDispatchOutputStore.ts'
import {
  commandDispatchOutputTheme,
  createCommandDispatchOutputRenderCursor,
  planCommandDispatchOutputRender,
} from './commandDispatchOutputRender.ts'

test('命令镜像跟随应用主题并尊重终端固定主题', () => {
  const settings = terminalSettings('follow_app')
  assert.equal(commandDispatchOutputTheme(settings, 'dark').background, '#080a0f')
  assert.equal(commandDispatchOutputTheme(settings, 'light').background, '#fbfcfe')
  assert.equal(
    commandDispatchOutputTheme(terminalSettings('dark'), 'light').background,
    '#080a0f',
  )
})

test('连续输出按累计数据增量写入', () => {
  const initial = planCommandDispatchOutputRender(
    createCommandDispatchOutputRenderCursor(),
    snapshot(1, [0x61, 0x62], [0x61, 0x62]),
  )
  assert.equal(initial.mode, 'reset')
  assert.deepEqual([...initial.data], [0x61, 0x62])

  const next = planCommandDispatchOutputRender(
    initial.cursor,
    snapshot(2, [0x61, 0x62, 0x63], [0x63]),
  )
  assert.equal(next.mode, 'append')
  assert.deepEqual([...next.data], [0x63])
})

test('React 跳过中间 publish 且最终控制帧清空 chunk 时完整重放累计输出', () => {
  const initial = planCommandDispatchOutputRender(
    createCommandDispatchOutputRenderCursor(),
    snapshot(1, [0x61], [0x61]),
  )
  const finalControl = planCommandDispatchOutputRender(
    initial.cursor,
    snapshot(3, [0x61, 0x62, 0x63], []),
  )

  assert.equal(finalControl.mode, 'reset')
  assert.deepEqual([...finalControl.data], [0x61, 0x62, 0x63])
})

test('缓存截断、长度回退或非单调 revision 均完整重放', () => {
  const initial = planCommandDispatchOutputRender(
    createCommandDispatchOutputRenderCursor(),
    snapshot(5, [0x61, 0x62, 0x63], [0x61, 0x62, 0x63]),
  )
  const resetRevision = planCommandDispatchOutputRender(
    initial.cursor,
    snapshot(6, [0x62, 0x63], [], 1),
  )
  assert.equal(resetRevision.mode, 'reset')
  assert.deepEqual([...resetRevision.data], [0x62, 0x63])

  const backwards = planCommandDispatchOutputRender(
    resetRevision.cursor,
    snapshot(5, [0x63], []),
  )
  assert.equal(backwards.mode, 'reset')
  assert.deepEqual([...backwards.data], [0x63])
})

function snapshot(
  revision: number,
  data: number[],
  chunk: number[],
  resetRevision = 0,
): CommandDispatchOutputSnapshot {
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    revision,
    data: new Uint8Array(data),
    chunk: new Uint8Array(chunk),
    resetRevision,
    connected: true,
    ended: false,
    truncated: resetRevision > 0,
  }
}

function terminalSettings(themeMode: TerminalSettings['theme_mode']): TerminalSettings {
  return {
    font_family: 'FiraCode-Medium',
    font_size: 14,
    line_height: 1.2,
    letter_spacing: 0,
    cursor_style: 'block',
    cursor_blink: true,
    theme_mode: themeMode,
    scrollback: 5_000,
  }
}
