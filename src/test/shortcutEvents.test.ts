import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compileShortcutIndex,
  createShortcutChord,
  matchShortcutAction,
  normalizeKeyboardEventToChord,
  setShortcutBindingOverride,
} from '../features/shortcuts/index.ts'
import type { ShortcutKeyboardEventLike } from '../features/shortcuts/index.ts'

function keyboardEvent(
  code: string,
  key: string,
  values: Partial<ShortcutKeyboardEventLike> = {},
): ShortcutKeyboardEventLike {
  return { type: 'keydown', code, key, ...values }
}

test('键盘事件规范化为物理 code 与有序修饰键，并可抽象 Primary', () => {
  assert.deepEqual(
    normalizeKeyboardEventToChord(
      keyboardEvent('KeyC', 'C', { ctrlKey: true, shiftKey: true }),
    ),
    createShortcutChord('KeyC', 'C', ['control', 'shift']),
  )
  assert.deepEqual(
    normalizeKeyboardEventToChord(
      keyboardEvent('KeyC', 'c', { metaKey: true }),
      { platform: 'darwin', mapPrimaryModifier: true },
    ),
    createShortcutChord('KeyC', 'c', ['primary']),
  )
})

test('IME、AltGraph、已处理和无效键盘事件不会生成 chord', () => {
  const invalidEvents: ShortcutKeyboardEventLike[] = [
    keyboardEvent('KeyA', 'a', { isComposing: true }),
    keyboardEvent('KeyA', 'a', { keyCode: 229 }),
    keyboardEvent('KeyA', 'Dead'),
    keyboardEvent('Unidentified', 'Unidentified'),
    keyboardEvent('ControlLeft', 'Control', { ctrlKey: true }),
    keyboardEvent('KeyA', 'a', { defaultPrevented: true }),
    keyboardEvent('KeyA', 'a', { type: 'keyup' }),
    keyboardEvent('KeyQ', '@', {
      ctrlKey: true,
      altKey: true,
      getModifierState: (key) => key === 'AltGraph',
    }),
  ]
  for (const event of invalidEvents) {
    assert.equal(normalizeKeyboardEventToChord(event), null)
  }
})

test('预编译索引同步匹配活动作用域，并让补全瞬态优先', () => {
  const index = compileShortcutIndex({}, 'win32')
  assert.equal(
    matchShortcutAction(
      index,
      keyboardEvent('KeyH', 'H', { ctrlKey: true, shiftKey: true }),
      [],
    ),
    'app.host_launcher.open',
  )
  assert.equal(
    matchShortcutAction(
      index,
      keyboardEvent('Enter', 'Enter'),
      ['terminal.completion.visible', 'terminal.active'],
    ),
    'terminal.completion.accept',
  )
  assert.equal(
    matchShortcutAction(index, keyboardEvent('Enter', 'Enter'), ['files.list']),
    'files.open_focused',
  )
  assert.equal(
    matchShortcutAction(
      index,
      keyboardEvent('Enter', 'Enter', { isComposing: true }),
      ['terminal.completion.visible'],
    ),
    null,
  )

  const conflicting = setShortcutBindingOverride(
    {},
    'terminal.search.open',
    [createShortcutChord('Enter', 'Enter')],
  )
  const conflictIndex = compileShortcutIndex(conflicting, 'win32')
  assert.equal(
    matchShortcutAction(
      conflictIndex,
      keyboardEvent('Enter', 'Enter'),
      ['terminal.active', 'terminal.completion.visible'],
    ),
    'terminal.completion.accept',
  )
})
