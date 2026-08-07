import assert from 'node:assert/strict'
import test from 'node:test'
import type { Terminal } from '@xterm/xterm'
import {
  captureTerminalPointerTarget,
  classifyTerminalContextValue,
  terminalPointerCell,
} from './terminalContextTarget.ts'

test('URL 仅接受安全的 HTTP 与 HTTPS 地址并清理句末标点', () => {
  assert.deepEqual(
    classifyTerminalContextValue('"https://example.com/docs?q=1".', 'selection'),
    {
      kind: 'url',
      source: 'selection',
      value: 'https://example.com/docs?q=1',
    },
  )
  assert.equal(
    classifyTerminalContextValue('https://user:secret@example.com', 'selection'),
    null,
  )
  assert.equal(classifyTerminalContextValue('file:///tmp/a', 'selection'), null)
  assert.equal(classifyTerminalContextValue('https://example.com/\nnext', 'selection'), null)
  assert.equal(classifyTerminalContextValue('https://example.com\n', 'selection'), null)
})

test('URL 保留合法的成对括号并移除非配对句末括号', () => {
  assert.equal(
    classifyTerminalContextValue('https://example.com/a(b)', 'pointer')?.value,
    'https://example.com/a(b)',
  )
  assert.equal(
    classifyTerminalContextValue('https://example.com/docs)', 'pointer')?.value,
    'https://example.com/docs',
  )
})

test('URL 清理中文句末标点与成对引号', () => {
  assert.equal(
    classifyTerminalContextValue('https://example.com/docs。', 'pointer')?.value,
    'https://example.com/docs',
  )
  assert.equal(
    classifyTerminalContextValue('“https://example.com/docs”', 'selection')?.value,
    'https://example.com/docs',
  )
})

test('URL 按 UTF-8 字节限制长度并拒绝 C1 控制字符', () => {
  assert.equal(
    classifyTerminalContextValue(`https://example.com/${'文'.repeat(700)}`, 'selection'),
    null,
  )
  assert.equal(
    classifyTerminalContextValue('https://example.com/\u0085docs', 'selection'),
    null,
  )
})

test('POSIX 路径区分绝对、当前目录相对和 HOME 相对语义', () => {
  assert.deepEqual(classifyTerminalContextValue('/opt/termous', 'selection'), {
    kind: 'path',
    source: 'selection',
    value: '/opt/termous',
    resolution: 'absolute',
    requiresCwd: false,
    copyOnly: false,
  })
  const parentRelative = classifyTerminalContextValue('../logs/app.log', 'pointer')
  const nestedRelative = classifyTerminalContextValue('config/app.yaml', 'pointer')
  const homeRelative = classifyTerminalContextValue('~/downloads', 'pointer')
  assert.equal(parentRelative?.kind === 'path' && parentRelative.requiresCwd, true)
  assert.equal(nestedRelative?.kind === 'path' && nestedRelative.requiresCwd, true)
  assert.equal(homeRelative?.kind === 'path' && homeRelative.copyOnly, true)
})

test('POSIX 路径拒绝命令替换、通配符、Windows 路径和普通文本', () => {
  assert.equal(classifyTerminalContextValue('/tmp/$(whoami)', 'selection'), null)
  assert.equal(classifyTerminalContextValue('/tmp/*.log', 'selection'), null)
  assert.equal(classifyTerminalContextValue('C:\\Windows\\System32', 'selection'), null)
  assert.equal(classifyTerminalContextValue('plain-text', 'selection'), null)
})

test('完整选区允许带空格的 POSIX 路径但鼠标分词不跨越空白', () => {
  const absolute = classifyTerminalContextValue('"/tmp/release files/app.log"', 'selection')
  const relative = classifyTerminalContextValue('build output/app.log', 'selection')
  assert.equal(absolute?.kind === 'path' && absolute.value, '/tmp/release files/app.log')
  assert.equal(relative?.kind === 'path' && relative.value, 'build output/app.log')
  assert.equal(classifyTerminalContextValue('/tmp/release files', 'pointer'), null)
})

test('鼠标坐标只通过公开终端尺寸映射到可见单元格', () => {
  const terminal = fakeTerminal(['0123456789'], {
    columns: 10,
    rows: 2,
    width: 100,
    height: 40,
  })
  assert.deepEqual(terminalPointerCell(terminal, { clientX: 25, clientY: 30 }), {
    column: 2,
    row: 1,
  })
  assert.equal(terminalPointerCell(terminal, { clientX: 100, clientY: 10 }), null)
})

test('鼠标目标识别跨 wrapped line 并正确处理宽字符单元格', () => {
  const terminal = fakeTerminal([
    { text: '输出 https://exa', wrapped: false },
    { text: 'mple.com/文档', wrapped: true },
  ], {
    columns: 16,
    rows: 2,
    width: 160,
    height: 40,
  })

  const target = captureTerminalPointerTarget(terminal, {
    clientX: 80,
    clientY: 30,
  })
  assert.equal(target?.kind, 'url')
  assert.equal(target?.value, 'https://example.com/文档')
})

test('宽字符首格和延续格都命中同一个路径目标', () => {
  for (const value of ['/tmp/中文/log', '/tmp/📦/log']) {
    const terminal = fakeTerminal([value], {
      columns: 20,
      rows: 1,
      width: 200,
      height: 20,
    })
    for (const column of [5, 6]) {
      const target = captureTerminalPointerTarget(terminal, {
        clientX: column * 10 + 5,
        clientY: 10,
      })
      assert.equal(target?.kind, 'path')
      assert.equal(target?.value, value)
      assert.deepEqual(
        target?.kind === 'path' ? target.selectionRange : null,
        {
          column: 0,
          row: 0,
          length: value === '/tmp/中文/log' ? 13 : 11,
        },
      )
    }
  }
})

test('路径选中范围可跨越终端自动换行', () => {
  const terminal = fakeTerminal([
    { text: '/opt/relea', wrapped: false },
    { text: 'se/file', wrapped: true },
  ], {
    columns: 10,
    rows: 2,
    width: 100,
    height: 40,
  })
  const target = captureTerminalPointerTarget(terminal, {
    clientX: 25,
    clientY: 30,
  })
  assert.equal(target?.kind, 'path')
  assert.equal(target?.value, '/opt/release/file')
  assert.deepEqual(
    target?.kind === 'path' ? target.selectionRange : null,
    {
      column: 0,
      row: 0,
      length: 17,
    },
  )
})

test('路径选中范围使用滚动缓冲区的绝对行号', () => {
  const terminal = fakeTerminal([
    'history',
    'history',
    '/var/log',
  ], {
    columns: 12,
    rows: 1,
    width: 120,
    height: 20,
    viewportY: 2,
  })
  const target = captureTerminalPointerTarget(terminal, {
    clientX: 25,
    clientY: 10,
  })
  assert.deepEqual(
    target?.kind === 'path' ? target.selectionRange : null,
    {
      column: 0,
      row: 2,
      length: 8,
    },
  )
})

test('鼠标可以从提示符相邻文本中提取绝对路径', () => {
  const terminal = fakeTerminal(['root@host:/var/log#'], {
    columns: 20,
    rows: 1,
    width: 200,
    height: 20,
  })
  const target = captureTerminalPointerTarget(terminal, {
    clientX: 125,
    clientY: 10,
  })
  assert.equal(target?.kind, 'path')
  assert.equal(target?.value, '/var/log')
  assert.deepEqual(
    target?.kind === 'path' ? target.selectionRange : null,
    {
      column: 10,
      row: 0,
      length: 8,
    },
  )

  const promptTarget = captureTerminalPointerTarget(terminal, {
    clientX: 25,
    clientY: 10,
  })
  assert.equal(promptTarget, null)
})

test('拒绝从被行数或字符上限截断的逻辑行中识别路径', () => {
  const tooManyWrappedRows = fakeTerminal(
    Array.from({ length: 17 }, (_, index) => ({
      text: index === 0 ? '/very/long/' : `segment-${index}/`,
      wrapped: index > 0,
    })),
    {
      columns: 24,
      rows: 17,
      width: 240,
      height: 340,
    },
  )
  assert.equal(
    captureTerminalPointerTarget(tooManyWrappedRows, {
      clientX: 65,
      clientY: 330,
    }),
    null,
  )

  const tooManyCharacters = fakeTerminal([
    `/tmp/${'a'.repeat(4096)}`,
  ], {
    columns: 4_200,
    rows: 1,
    width: 4_200,
    height: 20,
  })
  assert.equal(
    captureTerminalPointerTarget(tooManyCharacters, {
      clientX: 10,
      clientY: 10,
    }),
    null,
  )
})

interface FakeTerminalOptions {
  columns: number
  rows: number
  width: number
  height: number
  viewportY?: number
}

function fakeTerminal(
  values: Array<string | { text: string; wrapped: boolean }>,
  options: FakeTerminalOptions,
) {
  const lines = values.map((value) => {
    const item = typeof value === 'string' ? { text: value, wrapped: false } : value
    const cells = bufferCells(item.text, options.columns)
    return {
      isWrapped: item.wrapped,
      length: options.columns,
      getCell(column: number) {
        return cells[column]
      },
      translateToString() {
        return item.text
      },
    }
  })
  return {
    cols: options.columns,
    rows: options.rows,
    element: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: options.width,
        bottom: options.height,
        width: options.width,
        height: options.height,
      }),
    },
    buffer: {
      active: {
        viewportY: options.viewportY ?? 0,
        length: lines.length,
        getLine: (row: number) => lines[row],
      },
    },
  } as unknown as Terminal
}

function bufferCells(value: string, columns: number) {
  const cells: Array<{ getChars: () => string; getWidth: () => number }> = []
  for (const character of value) {
    const width = isWideCharacter(character) ? 2 : 1
    cells.push({
      getChars: () => character,
      getWidth: () => width,
    })
    if (width === 2) {
      cells.push({
        getChars: () => '',
        getWidth: () => 0,
      })
    }
  }
  while (cells.length < columns) {
    cells.push({
      getChars: () => '',
      getWidth: () => 1,
    })
  }
  return cells.slice(0, columns)
}

function isWideCharacter(value: string) {
  return (value.codePointAt(0) ?? 0) > 255
}
