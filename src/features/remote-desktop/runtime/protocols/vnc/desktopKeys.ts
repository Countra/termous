// 公共键位转换集中于适配器，不要求调用者了解 X11 keysym。
const special: Record<string, number> = {
  Escape: 0xff1b, Enter: 0xff0d, NumpadEnter: 0xff8d, Tab: 0xff09, Backspace: 0xff08,
  Insert: 0xff63, Delete: 0xffff, Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56,
  ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54,
  ShiftLeft: 0xffe1, ShiftRight: 0xffe2, ControlLeft: 0xffe3, ControlRight: 0xffe4,
  AltLeft: 0xffe9, AltRight: 0xffea, MetaLeft: 0xffeb, MetaRight: 0xffec,
  CapsLock: 0xffe5, NumLock: 0xff7f, ScrollLock: 0xff14, PrintScreen: 0xff61,
  ContextMenu: 0xff67, Space: 32, Minus: 45, Equal: 61, BracketLeft: 91, BracketRight: 93,
  Backslash: 92, Semicolon: 59, Quote: 39, Backquote: 96, Comma: 44, Period: 46, Slash: 47,
  NumpadAdd: 0xffab, NumpadSubtract: 0xffad, NumpadMultiply: 0xffaa, NumpadDivide: 0xffaf, NumpadDecimal: 0xffae,
}
export function desktopKeysym(code: string): number {
  if (special[code]) return special[code]
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) + 32
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5)
  if (/^Numpad[0-9]$/.test(code)) return 0xffb0 + Number(code[6])
  if (/^F([1-9]|1[0-2])$/.test(code)) return 0xffbd + Number(code.slice(1))
  throw new Error('desktop_capability_unsupported')
}
