import type { ShortcutKeyboardEventLike, ShortcutPlatform } from '#entities/shortcuts'

export function normalizeTerminalClipboardKeyEvent(
  event: ShortcutKeyboardEventLike,
  platform: ShortcutPlatform,
): ShortcutKeyboardEventLike {
  // Windows 剪贴板历史可能注入没有物理扫描码的 Ctrl+V；仅补齐这一已知键位，仍由统一快捷键决定动作。
  if (
    platform !== 'win32'
    || (event.code !== '' && event.code !== 'Unidentified')
    || (event.key !== 'v' && event.key !== 'V')
    || event.keyCode !== 86
    || (event.type !== 'keydown' && event.type !== 'keyup')
    || (event.type === 'keydown' && (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing))
  ) {
    return event
  }
  // keyup 时修饰状态可能已变化，仍须用相同 code 释放长按锁；DOM 事件属性不能靠对象展开复制。
  return {
    type: event.type,
    code: 'KeyV',
    key: event.key,
    keyCode: event.keyCode,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    defaultPrevented: event.defaultPrevented,
    isComposing: event.isComposing,
    getModifierState: event.getModifierState?.bind(event),
  }
}
