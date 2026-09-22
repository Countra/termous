import assert from 'node:assert/strict'
import test from 'node:test'
import { compileShortcutIndex, ShortcutRuntime, type ShortcutKeyboardEventLike } from '#entities/shortcuts'
import { normalizeTerminalClipboardKeyEvent } from './terminalClipboardKeyEvent.ts'

const paste: ShortcutKeyboardEventLike = { type: 'keydown', code: '', key: 'v', keyCode: 86, ctrlKey: true }

test('仅补齐 Windows 剪贴板注入事件的物理键码，并保留事件约束', () => {
  for (const code of ['', 'Unidentified']) {
    const event = { ...paste, code, shiftKey: true, repeat: true, defaultPrevented: true }
    const normalized = normalizeTerminalClipboardKeyEvent(event, 'win32')
    assert.equal(normalized.code, 'KeyV')
    assert.equal(normalized.shiftKey, true)
    assert.equal(normalized.repeat, true)
    assert.equal(normalized.defaultPrevented, true)
    assert.equal(event.code, code)
  }
  const release = normalizeTerminalClipboardKeyEvent({ ...paste, type: 'keyup', ctrlKey: false }, 'win32')
  assert.equal(release.code, 'KeyV')
  for (const platform of ['linux', 'darwin'] as const) {
    assert.equal(normalizeTerminalClipboardKeyEvent(paste, platform), paste)
  }
})

test('真实物理键位、输入法、其他按键及修饰组合保持原样', () => {
  for (const patch of [
    { code: 'KeyV' }, { code: 'KeyB' }, { key: 'Unidentified' }, { key: 'c' },
    { keyCode: 229 }, { keyCode: 0 }, { ctrlKey: false }, { altKey: true },
    { metaKey: true }, { isComposing: true }, { type: 'keypress' },
  ]) {
    const event = { ...paste, ...patch }
    assert.equal(normalizeTerminalClipboardKeyEvent(event, 'win32'), event)
  }
  const event = { ...paste, getModifierState(this: ShortcutKeyboardEventLike, modifier: string) {
    assert.equal(this, event)
    return modifier === 'AltGraph'
  } }
  assert.equal(normalizeTerminalClipboardKeyEvent(event, 'win32').getModifierState?.('AltGraph'), true)
})

test('缺码 V 松开时修饰状态变化仍释放长按锁，不影响后续改绑动作', () => {
  for (const changes of [{ altKey: true }, { metaKey: true }, { isComposing: true }]) {
    const runtime = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
    runtime.pushContext({ id: 'terminal', layer: 'focus', scopes: ['terminal.writable'] })
    runtime.registerHandler('terminal', 'terminal.paste', () => 'handled')
    const dispatch = (event: ShortcutKeyboardEventLike) => runtime.dispatch(
      normalizeTerminalClipboardKeyEvent(event, 'win32'), { adapterId: 'xterm:s1' },
    )
    assert.equal(dispatch(paste).result, 'handled')
    dispatch({ ...paste, type: 'keyup', ctrlKey: false, ...changes })
    runtime.updateIndex(compileShortcutIndex({ 'terminal.paste': { bindings: [] } }, 'win32'))
    assert.equal(dispatch({ ...paste, repeat: true }).result, 'fallthrough')
  }
})
