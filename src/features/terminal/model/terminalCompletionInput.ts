export type TerminalCompletionInputTrust =
  | 'waiting_prompt'
  | 'trusted'
  | 'uncertain'

export interface TerminalCompletionInputState {
  trust: TerminalCompletionInputTrust
  line: string
  cursorUtf16: number
  revision: number
  composing: boolean
}

export type TerminalCompletionInputDisposition =
  | 'tracked'
  | 'invalidated'
  | 'ignored'

export interface TerminalCompletionInputUpdate {
  state: TerminalCompletionInputState
  disposition: TerminalCompletionInputDisposition
}

const bracketedPastePrefix = '\x1b[200~'
const bracketedPasteSuffix = '\x1b[201~'
const maximumTrackedInputUtf16Length = 4 * 1024

export function createTerminalCompletionInputState(
  trust: TerminalCompletionInputTrust = 'waiting_prompt',
): TerminalCompletionInputState {
  return {
    trust,
    line: '',
    cursorUtf16: 0,
    revision: 0,
    composing: false,
  }
}

export function resetTerminalCompletionInput(
  state: TerminalCompletionInputState,
  trust: TerminalCompletionInputTrust,
): TerminalCompletionInputState {
  if (
    state.trust === trust
    && state.line.length === 0
    && state.cursorUtf16 === 0
    && !state.composing
  ) {
    return state
  }
  return {
    trust,
    line: '',
    cursorUtf16: 0,
    revision: state.revision + 1,
    composing: false,
  }
}

export function invalidateTerminalCompletionInput(
  state: TerminalCompletionInputState,
): TerminalCompletionInputState {
  return resetTerminalCompletionInput(state, 'uncertain')
}

export function beginTerminalCompletionComposition(
  state: TerminalCompletionInputState,
): TerminalCompletionInputState {
  if (state.composing) {
    return state
  }
  return {
    ...state,
    composing: true,
    revision: state.revision + 1,
  }
}

export function endTerminalCompletionComposition(
  state: TerminalCompletionInputState,
): TerminalCompletionInputState {
  if (!state.composing) {
    return state
  }
  return {
    ...state,
    composing: false,
    revision: state.revision + 1,
  }
}

export function applyTerminalCompletionData(
  state: TerminalCompletionInputState,
  data: string,
): TerminalCompletionInputUpdate {
  if (data.length === 0) {
    return { state, disposition: 'ignored' }
  }
  if (state.trust !== 'trusted' || state.composing) {
    return {
      state: invalidateTerminalCompletionInput(state),
      disposition: 'invalidated',
    }
  }

  const bracketedPaste = unwrapBracketedPaste(data)
  if (bracketedPaste !== null) {
    return applyTerminalCompletionPaste(state, bracketedPaste)
  }
  if (isSafeSingleLineText(data)) {
    if (!canTrackInsertion(state, data)) {
      return {
        state: invalidateTerminalCompletionInput(state),
        disposition: 'invalidated',
      }
    }
    return {
      state: insertTerminalCompletionText(state, data),
      disposition: 'tracked',
    }
  }

  switch (data) {
    case '\x7f':
    case '\b':
      return {
        state: removePreviousCodePoint(state),
        disposition: 'tracked',
      }
    case '\x1b[D':
    case '\x1bOD':
      return {
        state: moveCursorByCodePoint(state, -1),
        disposition: 'tracked',
      }
    case '\x1b[C':
    case '\x1bOC':
      return {
        state: moveCursorByCodePoint(state, 1),
        disposition: 'tracked',
      }
    case '\x1b[H':
    case '\x1bOH':
    case '\x01':
      return {
        state: setCursor(state, 0),
        disposition: 'tracked',
      }
    case '\x1b[F':
    case '\x1bOF':
    case '\x05':
      return {
        state: setCursor(state, state.line.length),
        disposition: 'tracked',
      }
    case '\x1b[3~':
      return {
        state: removeNextCodePoint(state),
        disposition: 'tracked',
      }
    default:
      return {
        state: invalidateTerminalCompletionInput(state),
        disposition: 'invalidated',
      }
  }
}

export function applyTerminalCompletionPaste(
  state: TerminalCompletionInputState,
  text: string,
): TerminalCompletionInputUpdate {
  if (
    state.trust !== 'trusted'
    || state.composing
    || !isSafeSingleLineText(text)
  ) {
    return {
      state: invalidateTerminalCompletionInput(state),
      disposition: 'invalidated',
    }
  }
  if (text.length === 0) {
    return { state, disposition: 'ignored' }
  }
  if (!canTrackInsertion(state, text)) {
    return {
      state: invalidateTerminalCompletionInput(state),
      disposition: 'invalidated',
    }
  }
  return {
    state: insertTerminalCompletionText(state, text),
    disposition: 'tracked',
  }
}

export function applyTerminalCompletionProgrammaticInput(
  state: TerminalCompletionInputState,
  text: string,
  execute: boolean,
): TerminalCompletionInputUpdate {
  if (execute) {
    return {
      state: invalidateTerminalCompletionInput(state),
      disposition: 'invalidated',
    }
  }
  return applyTerminalCompletionPaste(state, text)
}

export function insertTerminalCompletionText(
  state: TerminalCompletionInputState,
  text: string,
): TerminalCompletionInputState {
  if (text.length === 0) {
    return state
  }
  if (!canTrackInsertion(state, text)) {
    return invalidateTerminalCompletionInput(state)
  }
  const cursor = clampCursor(state.line, state.cursorUtf16)
  return {
    ...state,
    line: `${state.line.slice(0, cursor)}${text}${state.line.slice(cursor)}`,
    cursorUtf16: cursor + text.length,
    revision: state.revision + 1,
  }
}

function canTrackInsertion(
  state: TerminalCompletionInputState,
  text: string,
) {
  return state.line.length + text.length <= maximumTrackedInputUtf16Length
}

export function isSafeSingleLineText(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return true
}

function unwrapBracketedPaste(value: string) {
  if (
    !value.startsWith(bracketedPastePrefix)
    || !value.endsWith(bracketedPasteSuffix)
  ) {
    return null
  }
  return value.slice(bracketedPastePrefix.length, -bracketedPasteSuffix.length)
}

function removePreviousCodePoint(
  state: TerminalCompletionInputState,
): TerminalCompletionInputState {
  const cursor = clampCursor(state.line, state.cursorUtf16)
  if (cursor === 0) {
    return state
  }
  const previous = previousCodePointStart(state.line, cursor)
  return {
    ...state,
    line: `${state.line.slice(0, previous)}${state.line.slice(cursor)}`,
    cursorUtf16: previous,
    revision: state.revision + 1,
  }
}

function removeNextCodePoint(
  state: TerminalCompletionInputState,
): TerminalCompletionInputState {
  const cursor = clampCursor(state.line, state.cursorUtf16)
  if (cursor >= state.line.length) {
    return state
  }
  const next = nextCodePointEnd(state.line, cursor)
  return {
    ...state,
    line: `${state.line.slice(0, cursor)}${state.line.slice(next)}`,
    cursorUtf16: cursor,
    revision: state.revision + 1,
  }
}

function moveCursorByCodePoint(
  state: TerminalCompletionInputState,
  direction: -1 | 1,
): TerminalCompletionInputState {
  const cursor = clampCursor(state.line, state.cursorUtf16)
  const next = direction < 0
    ? previousCodePointStart(state.line, cursor)
    : nextCodePointEnd(state.line, cursor)
  return setCursor(state, next)
}

function setCursor(
  state: TerminalCompletionInputState,
  cursorUtf16: number,
): TerminalCompletionInputState {
  const cursor = clampCursor(state.line, cursorUtf16)
  if (cursor === state.cursorUtf16) {
    return state
  }
  return {
    ...state,
    cursorUtf16: cursor,
    revision: state.revision + 1,
  }
}

function previousCodePointStart(value: string, cursor: number) {
  if (cursor <= 0) {
    return 0
  }
  const trailing = value.charCodeAt(cursor - 1)
  if (
    trailing >= 0xdc00
    && trailing <= 0xdfff
    && cursor >= 2
  ) {
    const leading = value.charCodeAt(cursor - 2)
    if (leading >= 0xd800 && leading <= 0xdbff) {
      return cursor - 2
    }
  }
  return cursor - 1
}

function nextCodePointEnd(value: string, cursor: number) {
  if (cursor >= value.length) {
    return value.length
  }
  const leading = value.charCodeAt(cursor)
  if (
    leading >= 0xd800
    && leading <= 0xdbff
    && cursor + 1 < value.length
  ) {
    const trailing = value.charCodeAt(cursor + 1)
    if (trailing >= 0xdc00 && trailing <= 0xdfff) {
      return cursor + 2
    }
  }
  return cursor + 1
}

function clampCursor(value: string, cursor: number) {
  if (!Number.isSafeInteger(cursor)) {
    return value.length
  }
  return Math.max(0, Math.min(value.length, cursor))
}
