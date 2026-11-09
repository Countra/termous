export interface ReviewLine {
  kind: 'equal' | 'add' | 'remove'
  text: string
  before?: number
  after?: number
}
export interface LineDiff { lines: ReviewLine[]; added: number; removed: number; coarse: boolean }
type Edit = Pick<ReviewLine, 'kind' | 'text'>

export function textLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/gu) ?? []
}

// 使用 Myers 最短编辑路径；限制搜索距离，极端差异按完整区块展示，不丢失正文。
export function lineDiff(before: string, after: string): LineDiff {
  const a = textLines(before), b = textLines(after)
  let start = 0, end = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const left = a.slice(start, a.length - end), right = b.slice(start, b.length - end)
  const middle = shortestEdits(left, right)
  const edits: Edit[] = [
    ...a.slice(0, start).map(text => ({ kind: 'equal' as const, text })),
    ...(middle ?? [...left.map(text => ({ kind: 'remove' as const, text })), ...right.map(text => ({ kind: 'add' as const, text }))]),
    ...a.slice(a.length - end).map(text => ({ kind: 'equal' as const, text })),
  ]
  let oldLine = 0, newLine = 0, added = 0, removed = 0
  const lines = edits.map(edit => {
    if (edit.kind === 'add') added++
    if (edit.kind === 'remove') removed++
    return { ...edit, before: edit.kind === 'add' ? undefined : ++oldLine, after: edit.kind === 'remove' ? undefined : ++newLine }
  })
  return { lines, added, removed, coarse: middle === undefined }
}

function shortestEdits(a: string[], b: string[]): Edit[] | undefined {
  if (!a.length) return b.map(text => ({ kind: 'add', text }))
  if (!b.length) return a.map(text => ({ kind: 'remove', text }))
  const trace: Int32Array[] = []
  let comparisons = 0
  for (let depth = 0; depth <= Math.min(256, a.length + b.length); depth++) {
    const frontier = new Int32Array(2 * depth + 1)
    const previous = trace[depth - 1]
    for (let k = -depth; k <= depth; k += 2) {
      let x = depth === 0 ? 0 : k === -depth || k !== depth && previous[k - 1 + depth - 1] < previous[k + 1 + depth - 1]
        ? previous[k + 1 + depth - 1] : previous[k - 1 + depth - 1] + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++; y++
        if (++comparisons > 1_000_000) return undefined
      }
      frontier[k + depth] = x
      if (x >= a.length && y >= b.length) {
        trace.push(frontier)
        return backtrack(trace, a, b)
      }
    }
    trace.push(frontier)
  }
  return undefined
}

function backtrack(trace: Int32Array[], a: string[], b: string[]): Edit[] {
  let x = a.length, y = b.length
  const edits: Edit[] = []
  for (let depth = trace.length - 1; depth > 0; depth--) {
    const previous = trace[depth - 1], k = x - y
    const previousK = k === -depth || k !== depth && previous[k - 1 + depth - 1] < previous[k + 1 + depth - 1] ? k + 1 : k - 1
    const previousX = previous[previousK + depth - 1], previousY = previousX - previousK
    while (x > previousX && y > previousY) { edits.push({ kind: 'equal', text: a[--x] }); y-- }
    if (x === previousX) edits.push({ kind: 'add', text: b[--y] })
    else edits.push({ kind: 'remove', text: a[--x] })
  }
  while (x > 0 && y > 0) { edits.push({ kind: 'equal', text: a[--x] }); y-- }
  return edits.reverse()
}

export type ReviewRow = { index: number; line: ReviewLine } | { index: number; omitted: number }
export function reviewRows(lines: ReviewLine[], allContext: boolean): ReviewRow[] {
  const rows: ReviewRow[] = []
  for (let index = 0; index < lines.length;) {
    if (allContext || lines[index].kind !== 'equal') { rows.push({ index, line: lines[index++] }); continue }
    let end = index
    while (end < lines.length && lines[end].kind === 'equal') end++
    const leading = index === 0 ? 0 : 3, trailing = end === lines.length ? 0 : 3
    if (end - index <= leading + trailing + 1) {
      while (index < end) rows.push({ index, line: lines[index++] })
    } else {
      for (let n = 0; n < leading; n++) rows.push({ index, line: lines[index++] })
      rows.push({ index, omitted: end - trailing - index })
      index = end - trailing
      while (index < end) rows.push({ index, line: lines[index++] })
    }
  }
  return rows
}
