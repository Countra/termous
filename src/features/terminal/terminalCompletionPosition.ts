export const TERMINAL_COMPLETION_POPUP_WIDTH = 288
export const TERMINAL_COMPLETION_ROW_HEIGHT = 44
export const TERMINAL_COMPLETION_MAX_ITEMS = 8

const defaultGap = 6
const defaultPadding = 8
const popupVerticalPadding = 10
const minimumVisibleHeight = 40

export interface TerminalCompletionRect {
  left: number
  top: number
  width: number
  height: number
}

export interface TerminalCompletionPositionInput {
  paneRect: TerminalCompletionRect
  screenRect: TerminalCompletionRect
  cursorX: number
  cursorY: number
  cellWidth: number
  cellHeight: number
  popupWidth: number
  popupHeight: number
  gap?: number
  padding?: number
}

export interface TerminalCompletionPopupPosition {
  left: number
  top: number
  maxWidth: number
  maxHeight: number
  placement: 'above' | 'below'
}

export interface TerminalCompletionCursorPredictionInput {
  anchorX: number
  anchorY: number
  columns: number
  rows: number
  line: string
  cursorUtf16: number
}

export interface TerminalCompletionCursorPrediction {
  cursorX: number
  cursorY: number
}

export function predictTerminalCompletionCursor(
  input: TerminalCompletionCursorPredictionInput,
): TerminalCompletionCursorPrediction | null {
  if (
    !Number.isSafeInteger(input.anchorX)
    || !Number.isSafeInteger(input.anchorY)
    || !Number.isSafeInteger(input.columns)
    || !Number.isSafeInteger(input.rows)
    || !Number.isSafeInteger(input.cursorUtf16)
    || input.anchorX < 0
    || input.anchorY < 0
    || input.columns <= 0
    || input.rows <= 0
    || input.anchorX > input.columns
    || input.anchorY >= input.rows
    || input.cursorUtf16 < 0
    || input.cursorUtf16 > input.line.length
  ) {
    return null
  }

  const beforeCursor = input.line.slice(0, input.cursorUtf16)
  if (!isPredictableTerminalCompletionText(beforeCursor)) {
    return null
  }
  const currentLineCapacity = input.columns - input.anchorX
  if (beforeCursor.length <= currentLineCapacity) {
    return {
      cursorX: input.anchorX + beforeCursor.length,
      cursorY: input.anchorY,
    }
  }

  const wrappedCharacters = beforeCursor.length - currentLineCapacity
  const cursorY = input.anchorY + 1
    + Math.floor((wrappedCharacters - 1) / input.columns)
  if (cursorY >= input.rows) {
    return null
  }
  return {
    cursorX: ((wrappedCharacters - 1) % input.columns) + 1,
    cursorY,
  }
}

export function isPredictableTerminalCompletionText(value: string) {
  return /^[\x20-\x7e]*$/.test(value)
}

export function estimateTerminalCompletionPopupHeight(itemCount: number) {
  const visibleCount = Math.min(
    TERMINAL_COMPLETION_MAX_ITEMS,
    Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0,
  )
  return visibleCount === 0
    ? 0
    : visibleCount * TERMINAL_COMPLETION_ROW_HEIGHT + popupVerticalPadding
}

export function computeTerminalCompletionPosition(
  input: TerminalCompletionPositionInput,
): TerminalCompletionPopupPosition | null {
  if (!isValidInput(input)) {
    return null
  }

  const padding = Math.max(0, input.padding ?? defaultPadding)
  const gap = Math.max(0, input.gap ?? defaultGap)
  const paneWidth = input.paneRect.width
  const paneHeight = input.paneRect.height
  const maxWidth = Math.max(0, paneWidth - padding * 2)
  if (maxWidth <= 0) {
    return null
  }

  const popupWidth = Math.min(input.popupWidth, maxWidth)
  const cursorLeft = input.screenRect.left - input.paneRect.left
    + input.cursorX * input.cellWidth
  const cursorTop = input.screenRect.top - input.paneRect.top
    + input.cursorY * input.cellHeight
  const belowTop = cursorTop + input.cellHeight + gap
  const availableBelow = Math.max(0, paneHeight - padding - belowTop)
  const availableAbove = Math.max(0, cursorTop - gap - padding)
  const fitsBelow = input.popupHeight <= availableBelow
  const fitsAbove = input.popupHeight <= availableAbove
  const placement = fitsBelow || (!fitsAbove && availableBelow >= availableAbove)
    ? 'below'
    : 'above'
  const availableHeight = placement === 'below' ? availableBelow : availableAbove
  const maxHeight = Math.min(input.popupHeight, availableHeight)
  if (maxHeight < minimumVisibleHeight) {
    return null
  }

  const maxLeft = Math.max(padding, paneWidth - padding - popupWidth)
  const left = clamp(cursorLeft, padding, maxLeft)
  const desiredTop = placement === 'below'
    ? belowTop
    : cursorTop - gap - maxHeight
  const maxTop = Math.max(padding, paneHeight - padding - maxHeight)

  return {
    left: roundPixel(left),
    top: roundPixel(clamp(desiredTop, padding, maxTop)),
    maxWidth: roundPixel(maxWidth),
    maxHeight: roundPixel(maxHeight),
    placement,
  }
}

function isValidInput(input: TerminalCompletionPositionInput) {
  return (
    isValidRect(input.paneRect)
    && isValidRect(input.screenRect)
    && isNonNegativeFinite(input.cursorX)
    && isNonNegativeFinite(input.cursorY)
    && isPositiveFinite(input.cellWidth)
    && isPositiveFinite(input.cellHeight)
    && isPositiveFinite(input.popupWidth)
    && isPositiveFinite(input.popupHeight)
    && (input.gap === undefined || isNonNegativeFinite(input.gap))
    && (input.padding === undefined || isNonNegativeFinite(input.padding))
  )
}

function isValidRect(rect: TerminalCompletionRect) {
  return (
    Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && isPositiveFinite(rect.width)
    && isPositiveFinite(rect.height)
  )
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0
}

function isNonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function roundPixel(value: number) {
  return Math.round(value * 100) / 100
}
