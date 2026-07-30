import type { Terminal } from '@xterm/xterm'

export type TerminalMouseTrackingMode = Terminal['modes']['mouseTrackingMode']

export interface TerminalContextPointer {
  clientX: number
  clientY: number
}

export interface TerminalContextSelectionRange {
  column: number
  row: number
  length: number
}

export type TerminalContextTargetSource = 'selection' | 'pointer'

export interface TerminalUrlContextTarget {
  kind: 'url'
  source: TerminalContextTargetSource
  value: string
}

export interface TerminalPathContextTarget {
  kind: 'path'
  source: TerminalContextTargetSource
  value: string
  resolution: 'absolute' | 'cwd_relative' | 'home_relative'
  requiresCwd: boolean
  copyOnly: boolean
  selectionRange?: TerminalContextSelectionRange
}

export type TerminalContextTarget =
  | TerminalUrlContextTarget
  | TerminalPathContextTarget

export interface TerminalContextSnapshot {
  sessionId: string
  selectionText: string
  searchSeed: string
  target: TerminalContextTarget | null
  mouseTrackingMode: TerminalMouseTrackingMode
  writable: boolean
  disconnected: boolean
}

export const terminalContextSearchSeedLimit = 2048

const terminalContextTargetLimit = 4096
const terminalContextLogicalLineLimit = 16
const terminalContextUrlPattern = /https?:\/\/[^\s<>"']+/giu
const unsafePathCharacterPattern = /[$`*?[\]{}<>|;&()\\]/
const textEncoder = new TextEncoder()

export function normalizeTerminalSearchSeed(value: string) {
  if (
    !value.trim() ||
    value.length > terminalContextSearchSeedLimit ||
    /[\r\n]/.test(value)
  ) {
    return ''
  }
  return value
}

export function classifyTerminalContextValue(
  rawValue: string,
  source: TerminalContextTargetSource,
): TerminalContextTarget | null {
  if (
    !rawValue ||
    rawValue.length > terminalContextTargetLimit ||
    containsControlCharacter(rawValue)
  ) {
    return null
  }
  const value = trimTerminalTargetWrapper(rawValue.trim())
  if (!value) {
    return null
  }

  const url = classifyUrl(value, source)
  if (url) {
    return url
  }
  return classifyPath(value, source)
}

export function captureTerminalPointerTarget(
  terminal: Terminal,
  pointer: TerminalContextPointer,
): TerminalContextTarget | null {
  const cell = terminalPointerCell(terminal, pointer)
  if (!cell) {
    return null
  }
  const logicalLine = readTerminalLogicalLine(terminal, cell.row, cell.column)
  if (!logicalLine) {
    return null
  }
  const match = findTerminalTargetAt(logicalLine.text, logicalLine.offset)
  if (!match || match.target.kind !== 'path') {
    return match?.target ?? null
  }
  const selectionRange = terminalSelectionRangeForMatch(
    logicalLine,
    match.start,
    match.end,
  )
  return selectionRange
    ? { ...match.target, selectionRange }
    : match.target
}

export function terminalPointerCell(
  terminal: Terminal,
  pointer: TerminalContextPointer,
): { column: number; row: number } | null {
  const element = terminal.element
  if (!element || terminal.cols <= 0 || terminal.rows <= 0) {
    return null
  }
  const bounds = element.getBoundingClientRect()
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    pointer.clientX < bounds.left ||
    pointer.clientX >= bounds.right ||
    pointer.clientY < bounds.top ||
    pointer.clientY >= bounds.bottom
  ) {
    return null
  }
  return {
    column: Math.min(
      terminal.cols - 1,
      Math.max(0, Math.floor(((pointer.clientX - bounds.left) / bounds.width) * terminal.cols)),
    ),
    row: Math.min(
      terminal.rows - 1,
      Math.max(0, Math.floor(((pointer.clientY - bounds.top) / bounds.height) * terminal.rows)),
    ),
  }
}

function readTerminalLogicalLine(
  terminal: Terminal,
  viewportRow: number,
  targetColumn: number,
): TerminalLogicalLine | null {
  const buffer = terminal.buffer.active
  const targetBufferRow = buffer.viewportY + viewportRow
  if (targetBufferRow < 0 || targetBufferRow >= buffer.length) {
    return null
  }

  let firstRow = targetBufferRow
  let inspectedLines = 1
  while (firstRow > 0 && inspectedLines < terminalContextLogicalLineLimit) {
    const line = buffer.getLine(firstRow)
    if (!line?.isWrapped) {
      break
    }
    firstRow -= 1
    inspectedLines += 1
  }
  if (buffer.getLine(firstRow)?.isWrapped) {
    return null
  }

  const parts: string[] = []
  const cells: TerminalLogicalCell[] = []
  let targetOffset = -1
  let totalLength = 0
  let row = firstRow
  inspectedLines = 0
  while (row < buffer.length && inspectedLines < terminalContextLogicalLineLimit) {
    const line = buffer.getLine(row)
    if (!line) {
      break
    }
    const rendered = readTerminalBufferLine(line, terminal.cols, row, (
      row === targetBufferRow ? targetColumn : -1
    ))
    if (row === targetBufferRow) {
      targetOffset = totalLength + rendered.targetOffset
    }
    parts.push(rendered.text)
    cells.push(...rendered.cells.map((cell) => ({
      ...cell,
      textStart: cell.textStart + totalLength,
      textEnd: cell.textEnd + totalLength,
    })))
    totalLength += rendered.text.length
    inspectedLines += 1

    const next = buffer.getLine(row + 1)
    if (!next?.isWrapped) {
      break
    }
    row += 1
  }

  if (
    targetOffset < 0
    || totalLength > terminalContextTargetLimit
    || buffer.getLine(row + 1)?.isWrapped
  ) {
    return null
  }
  if (targetOffset >= terminalContextTargetLimit) {
    return null
  }
  return {
    text: parts.join(''),
    offset: targetOffset,
    columns: terminal.cols,
    cells,
  }
}

function readTerminalBufferLine(
  line: ReturnType<Terminal['buffer']['active']['getLine']> & {},
  columns: number,
  bufferRow: number,
  targetColumn: number,
) {
  let text = ''
  let targetOffset = targetColumn < 0 ? -1 : 0
  let previousVisibleCellOffset = -1
  const cells: TerminalLogicalCell[] = []
  const nullCell = line.getCell(0)
  for (let column = 0; column < Math.min(columns, line.length); column += 1) {
    const cell = line.getCell(column, nullCell)
    if (!cell) {
      continue
    }
    const width = cell.getWidth()
    if (width === 0) {
      if (column === targetColumn && previousVisibleCellOffset >= 0) {
        targetOffset = previousVisibleCellOffset
      }
      continue
    }
    const cellStart = text.length
    previousVisibleCellOffset = cellStart
    if (column === targetColumn || (width === 2 && column + 1 === targetColumn)) {
      targetOffset = cellStart
    }
    const chars = cell.getChars()
    text += chars || ' '
    cells.push({
      textStart: cellStart,
      textEnd: text.length,
      column,
      row: bufferRow,
      width,
    })
  }
  if (targetColumn >= Math.min(columns, line.length)) {
    targetOffset = text.length
  }
  return { text, targetOffset, cells }
}

function findTerminalTargetAt(text: string, offset: number): TerminalContextMatch | null {
  terminalContextUrlPattern.lastIndex = 0
  for (const match of text.matchAll(terminalContextUrlPattern)) {
    const raw = match[0]
    const start = match.index
    if (offset < start || offset >= start + raw.length) {
      continue
    }
    const target = classifyTerminalContextValue(raw, 'pointer')
    if (target?.kind === 'url') {
      const targetStart = start + raw.indexOf(target.value)
      const targetEnd = targetStart + target.value.length
      if (offset >= targetStart && offset < targetEnd) {
        return { target, start: targetStart, end: targetEnd }
      }
    }
  }

  const token = terminalTokenAt(text, offset)
  if (!token) {
    return null
  }
  const localOffset = offset - token.start
  const candidates = [{ value: token.value, start: 0 }]
  for (let index = 0; index < token.value.length; index += 1) {
    if (!isPathPrefixAt(token.value, index)) {
      continue
    }
    const previous = index > 0 ? token.value[index - 1] : ''
    if (index === 0 || /[=:("'[\]{},]/.test(previous)) {
      candidates.push({ value: token.value.slice(index), start: index })
    }
  }
  for (const candidate of candidates) {
    if (
      localOffset < candidate.start ||
      localOffset >= candidate.start + candidate.value.length
    ) {
      continue
    }
    const target = classifyTerminalContextValue(candidate.value, 'pointer')
    if (target?.kind === 'path') {
      const valueOffset = candidate.value.indexOf(target.value)
      if (valueOffset < 0) {
        continue
      }
      const targetStart = token.start + candidate.start + valueOffset
      const targetEnd = targetStart + target.value.length
      if (offset >= targetStart && offset < targetEnd) {
        return { target, start: targetStart, end: targetEnd }
      }
    }
  }
  return null
}

function terminalSelectionRangeForMatch(
  logicalLine: TerminalLogicalLine,
  start: number,
  end: number,
): TerminalContextSelectionRange | null {
  if (start < 0 || end <= start || end > logicalLine.text.length) {
    return null
  }
  const startCell = logicalLine.cells.find((cell) => (
    start >= cell.textStart && start < cell.textEnd
  ))
  const endCell = logicalLine.cells.find((cell) => (
    end - 1 >= cell.textStart && end - 1 < cell.textEnd
  ))
  if (!startCell || !endCell) {
    return null
  }
  const length = (
    (endCell.row - startCell.row) * logicalLine.columns
    + endCell.column
    + endCell.width
    - startCell.column
  )
  if (length <= 0) {
    return null
  }
  return {
    column: startCell.column,
    row: startCell.row,
    length,
  }
}

interface TerminalLogicalCell {
  textStart: number
  textEnd: number
  column: number
  row: number
  width: number
}

interface TerminalLogicalLine {
  text: string
  offset: number
  columns: number
  cells: TerminalLogicalCell[]
}

interface TerminalContextMatch {
  target: TerminalContextTarget
  start: number
  end: number
}

function terminalTokenAt(text: string, offset: number) {
  if (offset < 0 || offset >= text.length || /\s/.test(text[offset])) {
    return null
  }
  let start = offset
  let end = offset + 1
  while (start > 0 && !/\s/.test(text[start - 1])) {
    start -= 1
  }
  while (end < text.length && !/\s/.test(text[end])) {
    end += 1
  }
  return { value: text.slice(start, end), start, end }
}

function classifyUrl(
  value: string,
  source: TerminalContextTargetSource,
): TerminalUrlContextTarget | null {
  if (
    !/^https?:\/\//iu.test(value)
    || /\s/.test(value)
    || textEncoder.encode(value).byteLength > 2048
  ) {
    return null
  }
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return null
    }
  } catch {
    return null
  }
  return { kind: 'url', source, value }
}

function classifyPath(
  value: string,
  source: TerminalContextTargetSource,
): TerminalPathContextTarget | null {
  const normalizedValue = source === 'pointer'
    ? value.replace(/[#>$]+$/u, '')
    : value
  if (
    !normalizedValue ||
    (source === 'pointer' && /\s/.test(normalizedValue)) ||
    unsafePathCharacterPattern.test(normalizedValue) ||
    normalizedValue.includes('://')
  ) {
    return null
  }
  if (normalizedValue === '/' || normalizedValue.startsWith('/')) {
    return {
      kind: 'path',
      source,
      value: normalizedValue,
      resolution: 'absolute',
      requiresCwd: false,
      copyOnly: false,
    }
  }
  if (normalizedValue.startsWith('~/')) {
    return {
      kind: 'path',
      source,
      value: normalizedValue,
      resolution: 'home_relative',
      requiresCwd: false,
      copyOnly: true,
    }
  }
  if (
    normalizedValue.startsWith('./') ||
    normalizedValue.startsWith('../') ||
    isRelativePath(normalizedValue)
  ) {
    return {
      kind: 'path',
      source,
      value: normalizedValue,
      resolution: 'cwd_relative',
      requiresCwd: true,
      copyOnly: false,
    }
  }
  return null
}

function isRelativePath(value: string) {
  if (!value.includes('/') || value.startsWith('-') || value.includes(':')) {
    return false
  }
  return value.split('/').every((part) => part !== '')
}

function isPathPrefixAt(value: string, index: number) {
  return (
    value[index] === '/' ||
    value.startsWith('./', index) ||
    value.startsWith('../', index) ||
    value.startsWith('~/', index)
  )
}

function trimTerminalTargetWrapper(value: string) {
  let next = value
  const wrapperPairs: Record<string, string> = {
    '"': '"',
    "'": "'",
    '“': '”',
    '‘': '’',
    '(': ')',
    '[': ']',
    '{': '}',
    '<': '>',
  }
  for (let pass = 0; pass < 3 && next.length >= 2; pass += 1) {
    next = next.replace(/[.,;:!?。；，！？]+$/u, '')
    const closing = wrapperPairs[next[0]]
    if (!closing || next[next.length - 1] !== closing) {
      break
    }
    next = next.slice(1, -1)
  }
  next = next.replace(/[.,;:!?。；，！？]+$/u, '')
  while (hasUnmatchedTrailingCloser(next)) {
    next = next.slice(0, -1)
  }
  return next
}

function hasUnmatchedTrailingCloser(value: string) {
  const closing = value[value.length - 1]
  const opening = closing === ')' ? '(' : closing === ']' ? '[' : closing === '}' ? '{' : ''
  if (!opening) {
    return false
  }
  let depth = 0
  for (const character of value) {
    if (character === opening) {
      depth += 1
    } else if (character === closing) {
      depth -= 1
    }
  }
  return depth < 0
}

function containsControlCharacter(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true
    }
  }
  return false
}
