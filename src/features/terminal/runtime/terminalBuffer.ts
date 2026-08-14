import type { TerminalEntry } from './terminalRuntimeTypes.ts'
import { createEmptyTerminalSearchResult } from '../model/terminalSearch.ts'

export function clearTerminalBuffer(entry: TerminalEntry | null | undefined) {
  if (!entry || entry.disposed) {
    return false
  }
  const bufferBeforeClear = entry.terminal.buffer.active
  const anchorBeforeClear = entry.completionPromptAnchor
  const rebaseableAnchor = (
    anchorBeforeClear
    && bufferBeforeClear.type === 'normal'
    && anchorBeforeClear.cursorY === bufferBeforeClear.cursorY
  ) ? { ...anchorBeforeClear } : null
  try {
    entry.terminal.clear()
  } catch {
    return false
  }
  const bufferAfterClear = entry.terminal.buffer.active
  entry.completionPromptAnchor = rebaseableAnchor && bufferAfterClear.type === 'normal'
    ? { ...rebaseableAnchor, cursorY: bufferAfterClear.cursorY }
    : null
  entry.searchResult = createEmptyTerminalSearchResult()
  entry.searchDecorationKey = ''
  runPostClearCleanup(() => entry.search.clearDecorations())
  runPostClearCleanup(() => entry.terminal.clearSelection())
  return true
}

function runPostClearCleanup(cleanup: () => void) {
  try {
    cleanup()
  } catch {
    // 核心清屏已经完成，附属装饰清理失败不应改变成功结果。
  }
}
