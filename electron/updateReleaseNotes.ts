const dangerousBlockPattern = /<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const commentPattern = /<!--[\s\S]*?-->/g
const headingOpenPattern = /<h([1-6])\b[^>]*>/gi
const headingClosePattern = /<\/h[1-6]\s*>/gi
const orderedListBlockPattern = /<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/gi
const listItemOpenPattern = /<li\b[^>]*>/gi
const listItemClosePattern = /<\/li\s*>/gi
const blockOpenPattern = /<(?:p|div|section|article|ul)\b[^>]*>/gi
const blockClosePattern = /<\/(?:p|div|section|article|ul)\s*>/gi
const lineBreakPattern = /<br\s*\/?>/gi
const strongOpenPattern = /<(?:strong|b)\b[^>]*>/gi
const strongClosePattern = /<\/(?:strong|b)\s*>/gi
const codeOpenPattern = /<code\b[^>]*>/gi
const codeClosePattern = /<\/code\s*>/gi
const remainingTagPattern = /<[^>]*>/g
const maxProtectedCodeSegments = 2_048
export const updateReleaseNotesRawInputLimit = 32_000

export function normalizeUpdateReleaseNotesText(
  value: unknown,
  limit: number,
) {
  if (typeof value !== 'string' || limit <= 0) {
    return null
  }

  const boundedValue = replaceControlCharacters(
    truncateUpdateReleaseNotesRawInput(
      value,
      Math.max(limit, updateReleaseNotesRawInputLimit),
    ),
  ).replace(/\r\n?/g, '\n')
  const protectedCode = protectMarkdownCode(boundedValue)
  const structuredText = protectedCode.text
    .replace(commentPattern, ' ')
    .replace(dangerousBlockPattern, ' ')
    .replace(headingOpenPattern, (_match, level: string) => (
      `\n\n${'#'.repeat(Number.parseInt(level, 10))} `
    ))
    .replace(headingClosePattern, '\n\n')
    .replace(orderedListBlockPattern, (_match, content: string) => (
      convertOrderedList(content)
    ))
    .replace(listItemOpenPattern, '\n- ')
    .replace(listItemClosePattern, '')
    .replace(blockOpenPattern, '\n\n')
    .replace(blockClosePattern, '\n\n')
    .replace(lineBreakPattern, '\n\n')
    .replace(strongOpenPattern, '**')
    .replace(strongClosePattern, '**')
    .replace(codeOpenPattern, '`')
    .replace(codeClosePattern, '`')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")

  const normalized = restoreMarkdownCode(
    removeRemainingTagsOutsideInlineCode(structuredText)
      .split('\n')
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    protectedCode,
  )

  if (!normalized) {
    return null
  }
  return truncateNormalizedText(normalized, limit)
}

function removeRemainingTagsOutsideInlineCode(value: string) {
  return value
    .split(/(`[^`\n]*`)/g)
    .map((segment, index) => (
      index % 2 === 1
        ? segment
        : segment.replace(remainingTagPattern, ' ')
    ))
    .join('')
}

function protectMarkdownCode(value: string) {
  const segments: string[] = []
  const marker = createPlaceholderMarker(value)
  let protectedText = ''
  let cursor = 0

  while (cursor < value.length) {
    if (segments.length >= maxProtectedCodeSegments) {
      protectedText += storeProtectedCode(
        value.slice(cursor),
        marker,
        segments,
      )
      break
    }
    const fence = findNextFence(value, cursor)
    if (!fence) {
      protectedText += protectInlineCode(
        value.slice(cursor),
        marker,
        segments,
      )
      break
    }
    protectedText += protectInlineCode(
      value.slice(cursor, fence.start),
      marker,
      segments,
    )
    if (segments.length >= maxProtectedCodeSegments) {
      protectedText += storeProtectedCode(
        value.slice(fence.start),
        marker,
        segments,
      )
      break
    }
    protectedText += storeProtectedCode(
      value.slice(fence.start, fence.end),
      marker,
      segments,
    )
    cursor = fence.end
  }

  return {
    text: protectedText,
    marker,
    segments,
  }
}

function findNextFence(value: string, fromIndex: number) {
  let lineStart = fromIndex
  while (lineStart < value.length) {
    const lineEnd = value.indexOf('\n', lineStart)
    const contentEnd = lineEnd === -1 ? value.length : lineEnd
    if (/^[\t ]*```/.test(value.slice(lineStart, contentEnd))) {
      let closingStart = lineEnd === -1 ? value.length : lineEnd + 1
      while (closingStart < value.length) {
        const closingEnd = value.indexOf('\n', closingStart)
        const closingContentEnd = closingEnd === -1
          ? value.length
          : closingEnd
        if (/^[\t ]*```/.test(value.slice(closingStart, closingContentEnd))) {
          return {
            start: lineStart,
            end: closingContentEnd,
          }
        }
        if (closingEnd === -1) {
          break
        }
        closingStart = closingEnd + 1
      }
      return {
        start: lineStart,
        end: value.length,
      }
    }
    if (lineEnd === -1) {
      break
    }
    lineStart = lineEnd + 1
  }
  return null
}

function protectInlineCode(
  value: string,
  marker: string,
  segments: string[],
) {
  const parts: string[] = []
  let cursor = 0
  for (const match of value.matchAll(/`[^`\n]*`/g)) {
    const start = match.index ?? 0
    parts.push(value.slice(cursor, start))
    if (segments.length >= maxProtectedCodeSegments) {
      parts.push(storeProtectedCode(
        value.slice(start),
        marker,
        segments,
      ))
      return parts.join('')
    }
    parts.push(storeProtectedCode(match[0], marker, segments))
    cursor = start + match[0].length
  }
  parts.push(value.slice(cursor))
  return parts.join('')
}

function storeProtectedCode(
  value: string,
  marker: string,
  segments: string[],
) {
  const index = segments.length
  segments.push(value)
  return `${marker}${index}\uE001`
}

function createPlaceholderMarker(value: string) {
  let marker = '\uE000TERMOUS_UPDATE_CODE_'
  while (value.includes(marker)) {
    marker = `\uE000${marker}`
  }
  return marker
}

function restoreMarkdownCode(
  value: string,
  protectedCode: {
    marker: string
    segments: string[]
  },
) {
  const { marker, segments } = protectedCode
  if (segments.length === 0) {
    return value
  }
  const parts: string[] = []
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf(marker, cursor)
    if (start === -1) {
      parts.push(value.slice(cursor))
      break
    }
    const end = value.indexOf('\uE001', start + marker.length)
    if (end === -1) {
      parts.push(value.slice(cursor))
      break
    }
    const indexText = value.slice(start + marker.length, end)
    const index = Number.parseInt(indexText, 10)
    if (
      !/^\d+$/.test(indexText)
      || index < 0
      || index >= segments.length
    ) {
      parts.push(value.slice(cursor, end + 1))
      cursor = end + 1
      continue
    }
    parts.push(value.slice(cursor, start), segments[index])
    cursor = end + 1
  }
  return parts.join('')
}

function truncateNormalizedText(value: string, limit: number): string {
  if (Array.from(value).length <= limit) {
    return value
  }
  const budget = Math.max(0, limit - 1)
  const segmenter = createGraphemeSegmenter()
  let result = ''
  let used = 0
  for (const { segment } of segmenter.segment(value)) {
    const size = Array.from(segment).length
    if (used + size > budget) {
      break
    }
    result += segment
    used += size
  }
  return closeTruncatedInlineCode(`${result}…`)
}

function createGraphemeSegmenter() {
  const Segmenter = (
    Intl as unknown as {
      Segmenter: new (
        locale: string | undefined,
        options: { granularity: 'grapheme' },
      ) => {
        segment: (input: string) => Iterable<{
          index: number
          segment: string
        }>
      }
    }
  ).Segmenter
  return new Segmenter(undefined, {
    granularity: 'grapheme',
  })
}

function closeTruncatedInlineCode(value: string): string {
  if (!hasUnterminatedInlineCode(value)) {
    return value
  }
  const suffix = value.endsWith('…') ? '…' : ''
  const body = suffix ? value.slice(0, -1) : value
  const segments = Array.from(
    createGraphemeSegmenter().segment(body),
    ({ segment }) => segment,
  )
  if (segments.length <= 1) {
    return suffix
  }
  segments.pop()
  const closed = `${segments.join('')}\`${suffix}`
  return hasUnterminatedInlineCode(closed)
    ? suffix
    : closed
}

function hasUnterminatedInlineCode(value: string) {
  let fenced = false
  for (const line of value.split('\n')) {
    if (/^[\t ]*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      continue
    }
    const inlineMarkers = line.match(/`/g)?.length ?? 0
    if (inlineMarkers % 2 !== 0) {
      return true
    }
  }
  return false
}

export function closeUnterminatedUpdateReleaseNotesFence(
  value: string,
  limit: number,
) {
  if (!hasUnterminatedMarkdownFence(value)) {
    return value
  }
  const closingFence = '\n```'
  const bounded = truncateNormalizedText(
    value,
    Math.max(1, limit - Array.from(closingFence).length),
  )
  return hasUnterminatedMarkdownFence(bounded)
    ? `${bounded}${closingFence}`
    : bounded
}

function hasUnterminatedMarkdownFence(value: string) {
  let open = false
  for (const line of value.split('\n')) {
    if (/^[\t ]*```/.test(line)) {
      open = !open
    }
  }
  return open
}

export function truncateUpdateReleaseNotesRawInput(
  value: string,
  limit: number,
) {
  if (limit <= 0) {
    return ''
  }
  if (value.length <= limit) {
    return value
  }
  let safeEnd = 0
  for (const { index, segment } of createGraphemeSegmenter().segment(value)) {
    const end = index + segment.length
    if (end > limit) {
      break
    }
    safeEnd = end
  }
  return value.slice(0, safeEnd)
}

function replaceControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return (
      code <= 8
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31)
      || code === 127
    )
      ? ' '
      : character
  }).join('')
}

function convertOrderedList(value: string) {
  const items = Array.from(
    value.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi),
    (match) => match[1],
  )
  if (items.length === 0) {
    return `\n\n${value}\n\n`
  }
  return `\n\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\n`
}
