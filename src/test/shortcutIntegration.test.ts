import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appSource = readFileSync(
  fileURLToPath(new URL('../App.tsx', import.meta.url)),
  'utf8',
)
const shortcutProviderSource = readFileSync(
  fileURLToPath(new URL('../app/shortcut-runtime/ShortcutRuntimeProvider.tsx', import.meta.url)),
  'utf8',
)
const terminalRuntimeSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/TerminalRuntimeProvider.tsx', import.meta.url)),
  'utf8',
)
const terminalViewportSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/TerminalPaneViewport.tsx', import.meta.url)),
  'utf8',
)
const completionPopupSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/TerminalCompletionPopup.tsx', import.meta.url)),
  'utf8',
)
const completionStyles = readFileSync(
  fileURLToPath(new URL('../styles/terminal-completion.css', import.meta.url)),
  'utf8',
)
const filesPageSource = readFileSync(
  fileURLToPath(new URL('../features/files/FilesPage.tsx', import.meta.url)),
  'utf8',
)
const workbenchFileListSource = readFileSync(
  fileURLToPath(new URL('../features/workbench/WorkbenchFileList.tsx', import.meta.url)),
  'utf8',
)
const remoteTextEditorSource = readFileSync(
  fileURLToPath(new URL('../features/remote-file/ui/RemoteTextEditorModal.tsx', import.meta.url)),
  'utf8',
)
const termousDataSource = readFileSync(
  fileURLToPath(new URL('../app/useTermousData.ts', import.meta.url)),
  'utf8',
)

test('主机连接入口只通过统一窗口快捷键适配器触发', () => {
  assert.match(appSource, /<ShortcutRuntimeProvider settings=\{data\.settings\.shortcuts\}>/)
  assert.match(
    appSource,
    /<ShortcutWindowAdapter handlers=\{\{[\s\S]*?'app\.host_launcher\.open'[\s\S]*?openContextualHostLauncher\(\)/,
  )
  assert.doesNotMatch(appSource, /isHostLauncherShortcut/)
  assert.doesNotMatch(appSource, /addEventListener\('keydown'/)
})

test('窗口适配器只解析全局上下文，让局部适配器独占自身动作', () => {
  assert.match(terminalViewportSource, /data-shortcut-adapter="xterm"/)
  assert.match(shortcutProviderSource, /handlerContextIds: \[windowContextId\]/)
  assert.doesNotMatch(shortcutProviderSource, /contextIds: \[windowContextId\]/)
  assert.doesNotMatch(shortcutProviderSource, /isOwnedByShortcutAdapter/)
})

test('非 xterm 的终端区域仍由 viewport 适配器处理上下文动作', () => {
  assert.match(terminalViewportSource, /shortcutRuntime\.dispatch\(event\.nativeEvent/)
  assert.match(terminalViewportSource, /contextIds: \[shortcutContextId\]/)
  assert.match(terminalViewportSource, /target\.closest\('\[data-shortcut-adapter\]'\)/)
})

test('补全弹层只在实际显示快捷键提示时保留底部网格行', () => {
  assert.match(completionPopupSource, /showShortcutFooter \? 'has-shortcut-footer' : ''/)
  assert.match(
    completionStyles,
    /\.terminal-completion-popup\s*\{[\s\S]*?grid-template-rows: minmax\(0, 1fr\);/,
  )
  assert.match(
    completionStyles,
    /\.terminal-completion-popup\.has-shortcut-footer\s*\{\s*grid-template-rows: minmax\(0, 1fr\) 29px;/,
  )
})

test('补全绑定变化使用结构化 chord 签名而不是展示文本', () => {
  assert.match(terminalRuntimeSource, /bindingSignatures: shortcutBindingSignatures/)
  assert.match(terminalRuntimeSource, /shortcutBindingSignatures\.get\(actionId\)/)
  assert.doesNotMatch(terminalRuntimeSource, /shortcutLabels\.get\(actionId\)/)
})

test('断开的终端仍可通过选区上下文复制已有输出', () => {
  const contextStart = terminalRuntimeSource.indexOf('const shortcutContextId =')
  const contextEnd = terminalRuntimeSource.indexOf(
    'terminal.attachCustomKeyEventHandler',
    contextStart,
  )
  assert.notEqual(contextStart, -1)
  assert.notEqual(contextEnd, -1)
  const shortcutContextSource = terminalRuntimeSource.slice(contextStart, contextEnd)
  assert.match(
    shortcutContextSource,
    /const viewport = getViewportForSession\(sessionId\)[\s\S]*?!viewport\?\.active[\s\S]*?terminal\.hasSelection\(\)[\s\S]*?scopes\.push\('terminal\.selection'\)/,
  )
  assert.doesNotMatch(shortcutContextSource, /host\?\.isConnected/)
})

test('独立文件列表由聚焦上下文处理可配置动作并保留固定键语义', () => {
  const handlerStart = filesPageSource.indexOf('const handleFileTableKeyDown =')
  const handlerEnd = filesPageSource.indexOf(
    'const updateBreadcrumbScrollState =',
    handlerStart,
  )
  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  const handlerSource = filesPageSource.slice(handlerStart, handlerEnd)

  assert.match(filesPageSource, /data-shortcut-adapter="files-page"/)
  assert.match(filesPageSource, /scopes: \['files\.standalone', 'files\.list'\]/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.select_all'/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.open_focused'/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.rename_focused'/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.delete_selection'/)
  assert.match(handlerSource, /event\.key === ' '/)
  assert.match(handlerSource, /event\.key === 'Escape'/)
  assert.match(handlerSource, /event\.key === 'ContextMenu'/)
  assert.match(handlerSource, /navigationKey && \(event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey\)/)
  assert.match(handlerSource, /shortcutRuntime\.dispatch\(event\.nativeEvent/)
  assert.doesNotMatch(handlerSource, /event\.key === 'Enter'/)
  assert.doesNotMatch(handlerSource, /event\.key === 'F2'/)
  assert.doesNotMatch(handlerSource, /event\.key === 'Delete'/)
  assert.doesNotMatch(handlerSource, /event\.key\.toLowerCase\(\) === 'a'/)
})

test('工作台文件列表只迁移打开动作且不会重复经过窗口适配器', () => {
  assert.match(workbenchFileListSource, /data-shortcut-adapter="workbench-files"/)
  assert.match(workbenchFileListSource, /scopes: \['files\.list'\]/)
  assert.match(
    workbenchFileListSource,
    /registerHandler\([\s\S]*?'files\.open_focused'/,
  )
  assert.match(workbenchFileListSource, /shortcutRuntime\.dispatch\(event\.nativeEvent/)
  assert.match(workbenchFileListSource, /case 'ArrowDown'/)
  assert.match(workbenchFileListSource, /case ' '/)
  assert.match(workbenchFileListSource, /const shortcutFirst =/)
  assert.doesNotMatch(workbenchFileListSource, /case 'Enter'/)
})

test('远程编辑器保存只由编辑器快捷键上下文触发', () => {
  assert.match(remoteTextEditorSource, /data-shortcut-adapter="files-editor"/)
  assert.match(remoteTextEditorSource, /scopes: \['files\.editor'\]/)
  assert.match(
    remoteTextEditorSource,
    /registerHandler\([\s\S]*?'files\.editor\.save'/,
  )
  assert.match(remoteTextEditorSource, /onKeyDownCapture=\{handleShortcutKeyDownCapture\}/)
  assert.match(remoteTextEditorSource, /editable: true/)
  assert.doesNotMatch(remoteTextEditorSource, /window\.addEventListener\('keydown'/)
  assert.doesNotMatch(
    remoteTextEditorSource,
    /\(event\.ctrlKey \|\| event\.metaKey\).*event\.key\.toLowerCase\(\) === 's'/,
  )
})

test('较早的快捷键写入失败会通知对应行且不会回退较新的乐观状态', () => {
  const mutationStart = termousDataSource.indexOf('async updateShortcutSettings(')
  const mutationEnd = termousDataSource.indexOf('async setWindowSettings(', mutationStart)
  assert.notEqual(mutationStart, -1)
  assert.notEqual(mutationEnd, -1)
  const mutationSource = termousDataSource.slice(mutationStart, mutationEnd)
  assert.match(
    mutationSource,
    /if \(shortcutSettingsMutationRef\.current !== mutation\) \{\s*throw updateError\s*\}/,
  )
})
