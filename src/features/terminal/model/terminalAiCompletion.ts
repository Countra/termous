import type { TerminalAIInputSnapshot } from '#common/contracts'

export const TERMINAL_AI_COMPLETION_POPUP_WIDTH = 360
export const TERMINAL_AI_COMPLETION_MAX_HEIGHT = 320
export const TERMINAL_AI_COMPLETION_HEADER_HEIGHT = 28
// 抬头之外还需预留边框与输入区内边距，定位和输入自适应共用这一高度预算。
export const TERMINAL_AI_COMPLETION_CHROME_HEIGHT = TERMINAL_AI_COMPLETION_HEADER_HEIGHT + 18
export const TERMINAL_AI_COMPLETION_MIN_HEIGHT = TERMINAL_AI_COMPLETION_CHROME_HEIGHT + 28

export type TerminalAiAppendState = 'append' | 'mismatch' | 'exact' | 'stale'

export function sameTerminalAiInput(
  current: TerminalAIInputSnapshot | null,
  expected: TerminalAIInputSnapshot | null,
): boolean {
  return Boolean(current && expected
    && current.sourceGeneration === expected.sourceGeneration
    && current.shellId === expected.shellId
    && current.promptGeneration === expected.promptGeneration
    && current.inputEpoch === expected.inputEpoch
    && current.revision === expected.revision
    && current.line === expected.line
    && current.cursorUtf16 === expected.cursorUtf16)
}

export function terminalAiAppendState(
  current: TerminalAIInputSnapshot | null,
  expected: TerminalAIInputSnapshot | null,
  command: string,
): TerminalAiAppendState {
  if (!sameTerminalAiInput(current, expected) || !current
    || current.cursorUtf16 !== current.line.length) return 'stale'
  if (!isTerminalAiCommand(command) || !command.startsWith(current.line)) return 'mismatch'
  return command === current.line ? 'exact' : 'append'
}

export function isTerminalAiCommand(value: string): boolean {
  // 写入终端前再次拒绝控制字符，不能让模型输出成为按键或终端转义序列。
  return value.trim().length > 0
    && new TextEncoder().encode(value).length <= 4096
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
}
