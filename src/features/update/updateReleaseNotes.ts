export type UpdateReleaseNoteBlock =
  | {
      type: 'heading'
      level: number
      text: string
    }
  | {
      type: 'paragraph'
      text: string
    }
  | {
      type: 'unordered-list' | 'ordered-list'
      items: string[]
    }
  | {
      type: 'code'
      text: string
    }

export type UpdateReleaseNoteInlineToken =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'strong' | 'code'
      text: string
    }

const headingPattern = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/
const unorderedListPattern = /^\s*[-+*]\s+(.+)$/
const orderedListPattern = /^\s*\d+[.)]\s+(.+)$/
const codeFencePattern = /^\s*```/
const inlinePattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/g

export function resolveUpdateReleaseNotesContent(
  notes: string | null | undefined,
  fallback: string,
) {
  return notes?.trim() ? notes : fallback
}

export function parseUpdateReleaseNotes(
  value: string | null | undefined,
): UpdateReleaseNoteBlock[] {
  if (!value?.trim()) {
    return []
  }

  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const blocks: UpdateReleaseNoteBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = line.match(headingPattern)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      })
      index += 1
      continue
    }

    if (codeFencePattern.test(line)) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !codeFencePattern.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({
        type: 'code',
        text: codeLines.join('\n').trimEnd(),
      })
      continue
    }

    const list = matchListItem(line)
    if (list) {
      const items: string[] = []
      const listType = list.type
      while (index < lines.length) {
        const item = matchListItem(lines[index])
        if (!item || item.type !== listType) {
          break
        }
        items.push(item.text)
        index += 1
      }
      blocks.push({ type: listType, items })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const paragraphLine = lines[index]
      if (
        !paragraphLine.trim()
        || headingPattern.test(paragraphLine)
        || codeFencePattern.test(paragraphLine)
        || matchListItem(paragraphLine)
      ) {
        break
      }
      paragraphLines.push(paragraphLine.trim())
      index += 1
    }
    blocks.push({
      type: 'paragraph',
      text: paragraphLines.join(' '),
    })
  }

  return blocks
}

export function tokenizeUpdateReleaseNoteInline(
  value: string,
): UpdateReleaseNoteInlineToken[] {
  const tokens: UpdateReleaseNoteInlineToken[] = []
  let cursor = 0

  for (const match of value.matchAll(inlinePattern)) {
    const start = match.index ?? 0
    if (start > cursor) {
      tokens.push({
        type: 'text',
        text: value.slice(cursor, start),
      })
    }

    const token = match[0]
    if (token.startsWith('`')) {
      tokens.push({
        type: 'code',
        text: token.slice(1, -1),
      })
    } else {
      tokens.push({
        type: 'strong',
        text: token.slice(2, -2),
      })
    }
    cursor = start + token.length
  }

  if (cursor < value.length) {
    tokens.push({
      type: 'text',
      text: value.slice(cursor),
    })
  }

  return tokens.length > 0
    ? tokens
    : [{ type: 'text', text: value }]
}

function matchListItem(line: string) {
  const unordered = line.match(unorderedListPattern)
  if (unordered) {
    return {
      type: 'unordered-list' as const,
      text: unordered[1].trim(),
    }
  }

  const ordered = line.match(orderedListPattern)
  if (ordered) {
    return {
      type: 'ordered-list' as const,
      text: ordered[1].trim(),
    }
  }
  return null
}
