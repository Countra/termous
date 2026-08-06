import assert from 'node:assert/strict'
import {
  readdirSync,
  readFileSync,
} from 'node:fs'
import { extname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createShortcutChord,
  getShortcutReservation,
  SHORTCUT_ACTIONS,
} from '#entities/shortcuts'

const sources = {
  app: readSource('../App.tsx'),
  runtimeProvider: readSource('../app/shortcut-runtime/ShortcutRuntimeProvider.tsx'),
  terminalRuntime: readSource('../features/terminal/TerminalRuntimeProvider.tsx'),
  terminalViewport: readSource('../features/terminal/TerminalPaneViewport.tsx'),
  filesPage: readSource('../features/files/FilesPage.tsx'),
  workbenchFiles: readSource('../features/workbench/WorkbenchFileList.tsx'),
  editor: readSource('../features/files/RemoteTextEditorModal.tsx'),
  recorder: readSource('../features/settings/ui/shortcuts/ShortcutRecorderModal.tsx'),
}

test('所有首版动作均由统一动作目录和上下文适配器承接', () => {
  const adapterSources = [
    sources.app,
    sources.terminalRuntime,
    sources.terminalViewport,
    sources.filesPage,
    sources.workbenchFiles,
    sources.editor,
  ].join('\n')

  assert.equal(SHORTCUT_ACTIONS.length, 14)
  for (const action of SHORTCUT_ACTIONS) {
    assert.match(
      adapterSources,
      new RegExp(`['"]${escapeRegExp(action.id)}['"]`),
      `${action.id} 必须由一个生产适配器注册`,
    )
  }
  assert.doesNotMatch(sources.app, /isHostLauncherShortcut/)

  const xtermHandler = sliceBetween(
    sources.terminalRuntime,
    'terminal.attachCustomKeyEventHandler',
    'entry.disposables.push(',
  )
  assert.doesNotMatch(
    xtermHandler,
    /event\.(?:key|code)\s*===\s*['"](?:ArrowUp|ArrowDown|Enter|KeyC|KeyV)['"]/,
  )

  const fileHandler = sliceBetween(
    sources.filesPage,
    'const handleFileTableKeyDown =',
    'const updateBreadcrumbScrollState =',
  )
  assert.doesNotMatch(fileHandler, /event\.key\s*===\s*['"](?:Enter|F2|Delete)['"]/)
  assert.doesNotMatch(fileHandler, /event\.key\.toLowerCase\(\)\s*===\s*['"]a['"]/)
  assert.doesNotMatch(
    sources.editor,
    /\(event\.ctrlKey\s*\|\|\s*event\.metaKey\)[\s\S]{0,120}event\.key\.toLowerCase\(\)\s*===\s*['"]s['"]/,
  )
})

test('窗口适配器只解析全局 Handler，局部区域明确声明适配器边界', () => {
  const windowAdapter = sliceBetween(
    sources.runtimeProvider,
    'export function ShortcutWindowAdapter',
    'function isEditableTarget',
  )
  assert.match(windowAdapter, /scopes:\s*\['app\.global'\]/)
  assert.match(windowAdapter, /handlerContextIds:\s*\[windowContextId\]/)
  assert.doesNotMatch(windowAdapter, /contextIds:\s*\[windowContextId\]/)

  const adapterMarkers = new Map([
    [sources.terminalViewport, 'xterm'],
    [sources.filesPage, 'files-page'],
    [sources.workbenchFiles, 'workbench-files'],
    [sources.editor, 'files-editor'],
    [sources.recorder, 'recorder'],
  ])
  for (const [source, adapterId] of adapterMarkers) {
    assert.match(source, new RegExp(`data-shortcut-adapter=["']${adapterId}["']`))
  }
})

test('固定安全键与无障碍键不会进入用户可覆盖绑定', () => {
  const actionId = 'terminal.search.open'
  const reserved = [
    [createShortcutChord('Escape', 'Escape'), 'dismiss'],
    [createShortcutChord('Tab', 'Tab'), 'focus_traversal'],
    [createShortcutChord('ContextMenu', 'ContextMenu'), 'context_menu'],
    [createShortcutChord('F10', 'F10', ['shift']), 'context_menu'],
    [createShortcutChord('KeyF', 'f', ['control', 'alt', 'shift']), 'diagnostics'],
  ] as const

  for (const [chord, reservationId] of reserved) {
    assert.equal(getShortcutReservation(actionId, chord, 'win32')?.id, reservationId)
  }

  const xtermHandler = sliceBetween(
    sources.terminalRuntime,
    'terminal.attachCustomKeyEventHandler',
    'entry.disposables.push(',
  )
  assert.match(xtermHandler, /event\.key\s*===\s*['"]Escape['"]/)
  assert.match(xtermHandler, /event\.key\s*===\s*['"]Tab['"]/)
  assert.match(sources.terminalViewport, /event\.key\s*===\s*['"]ContextMenu['"]/)
  assert.match(
    sources.terminalViewport,
    /event\.shiftKey\s*&&\s*event\.key\s*===\s*['"]F10['"]/,
  )

  const electronMain = readSource('../../electron/main.ts')
  const diagnosticsHandler = sliceBetween(
    electronMain,
    'function registerDevToolsShortcut',
    'function createWindow',
  )
  assert.match(diagnosticsHandler, /before-input-event/)
  assert.match(diagnosticsHandler, /input\.control\s*&&\s*input\.shift\s*&&\s*input\.alt/)
  assert.match(diagnosticsHandler, /now\s*-\s*firstFAt\s*<=\s*DEVTOOLS_CHORD_WINDOW_MS/)
})

test('Electron 未注册操作系统级快捷键', () => {
  const electronRoot = fileURLToPath(new URL('../../electron/', import.meta.url))
  const productionSources = collectSourceFiles(electronRoot)
    .filter((path) => !path.includes('.test.'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

  assert.doesNotMatch(productionSources, /\bglobalShortcut\b/)
})

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

function sliceBetween(source: string, startToken: string, endToken: string) {
  const start = source.indexOf(startToken)
  const end = source.indexOf(endToken, start + startToken.length)
  assert.notEqual(start, -1, `缺少结构起点：${startToken}`)
  assert.notEqual(end, -1, `缺少结构终点：${endToken}`)
  return source.slice(start, end)
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    return ['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(entry.name)) ? [path] : []
  })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
