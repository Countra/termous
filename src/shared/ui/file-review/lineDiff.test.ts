import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { lineDiff, reviewRows, textLines } from './lineDiff.ts'

test('差异保持原始换行、BOM、空文件和重复行，能无损重建修改前后内容', () => {
  const cases = [
    ['', 'new\n'], ['old\n', ''], ['same', 'same'], ['a\nb\nc\n', 'a\nB\nc\n'],
    ['\ufeff中文\r\nlast', '中文\nlast\n'], ['x\nx\ny\nx\n', 'x\ny\nx\nx\n'],
  ]
  let seed = 42
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let n = 0; n < 400; n++) {
    const a = Array.from({ length: random() % 18 }, () => `${random() % 5}\n`).join('')
    const b = Array.from({ length: random() % 18 }, () => `${random() % 5}\n`).join('')
    cases.push([a, b])
  }
  for (const [a, b] of cases) {
    const result = lineDiff(a, b)
    assert.equal(result.lines.filter(row => row.kind !== 'add').map(row => row.text).join(''), a)
    assert.equal(result.lines.filter(row => row.kind !== 'remove').map(row => row.text).join(''), b)
    assert.equal(result.added, result.lines.filter(row => row.kind === 'add').length)
    assert.equal(result.removed, result.lines.filter(row => row.kind === 'remove').length)
    const left = textLines(a), right = textLines(b)
    const lcs = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
    for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
      lcs[i][j] = left[i - 1] === right[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1])
    }
    assert.equal(result.added + result.removed, left.length + right.length - 2 * lcs[left.length][right.length])
    assert.deepEqual(result.lines.filter(row => row.before !== undefined).map(row => row.before), Array.from({ length: result.lines.filter(row => row.before !== undefined).length }, (_, i) => i + 1))
  }
})

test('上下文折叠不会隐藏改动，极端替换有界并保留全文', () => {
  const a = Array.from({ length: 1000 }, (_, i) => `${i}\n`).join('')
  const result = lineDiff(a, a.replace('500\n', 'changed\n'))
  const rows = reviewRows(result.lines, false)
  assert.equal(rows.filter(row => 'line' in row && row.line.kind !== 'equal').length, 2)
  assert.ok(rows.length < 12)
  const huge = lineDiff('old\n'.repeat(16000), 'new\n'.repeat(16000))
  assert.equal(huge.coarse, true)
  assert.equal(huge.added, 16000)
  assert.equal(huge.removed, 16000)
})
