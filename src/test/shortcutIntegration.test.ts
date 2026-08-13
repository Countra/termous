import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  compileShortcutIndex,
  createShortcutChord,
  setShortcutBindingOverride,
  ShortcutRuntime,
  type ShortcutKeyboardEventLike,
} from '#entities/shortcuts'
import {
  applyFilesWorkspaceSelection,
  clearFilesWorkspaceSelection,
  createRemoteDirectoryViewState,
  type RemoteDirectoryViewState,
} from '../widgets/files-workspace/model/filesWorkspaceState.ts'

const appSource = readFileSync(
  fileURLToPath(new URL('../app/main/App.tsx', import.meta.url)),
  'utf8',
)
const shortcutProviderSource = readFileSync(
  fileURLToPath(new URL('../app/shortcut-runtime/ShortcutRuntimeProvider.tsx', import.meta.url)),
  'utf8',
)
const terminalRuntimeSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/runtime/TerminalRuntimeProvider.tsx', import.meta.url)),
  'utf8',
)
const terminalViewportSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/ui/TerminalPaneViewport.tsx', import.meta.url)),
  'utf8',
)
const completionPopupSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/ui/TerminalCompletionPopup.tsx', import.meta.url)),
  'utf8',
)
const completionStyles = readFileSync(
  fileURLToPath(new URL('../features/terminal/ui/TerminalCompletionPopup.module.scss', import.meta.url)),
  'utf8',
)
const filesPageSource = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/FilesWorkspace.tsx', import.meta.url)),
  'utf8',
)
const workbenchFileListSource = readFileSync(
  fileURLToPath(new URL('../features/workbench-files/ui/WorkbenchFileList.tsx', import.meta.url)),
  'utf8',
)
const remoteTextEditorSource = readFileSync(
  fileURLToPath(new URL('../features/remote-file/ui/RemoteTextEditorModal.tsx', import.meta.url)),
  'utf8',
)
const termousDataSource = readFileSync(
  fileURLToPath(new URL('../app/data-runtime/commands/settingsCommands.ts', import.meta.url)),
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
  assert.match(completionPopupSource, /showShortcutFooter \? styles\['has-shortcut-footer'\] : ''/)
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

test('独立文件列表声明聚焦上下文并注册可配置动作', () => {
  assert.match(filesPageSource, /data-shortcut-adapter="files-page"/)
  assert.match(filesPageSource, /scopes: \['files\.standalone', 'files\.list'\]/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.select_all'/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.open_focused'/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.rename_focused'/)
  assert.match(filesPageSource, /registerHandler\(filesShortcutContextId, 'files\.delete_selection'/)
  assert.match(filesPageSource, /shortcutRuntime\.dispatch\(event\.nativeEvent/)
})

test('文件快捷键通过真实运行时驱动选择和命令合同', () => {
  const paths = ['/srv/alpha.txt', '/srv/beta.txt', '/srv/gamma.txt']
  let state: RemoteDirectoryViewState = {
    ...createRemoteDirectoryViewState('/srv'),
    focusedPath: paths[1],
    selectedPaths: [paths[1]],
    anchorPath: paths[1],
  }
  let fileActionsEnabled = true
  const commands: string[] = []
  const runtime = new ShortcutRuntime({
    index: compileShortcutIndex({}, 'win32'),
  })
  const contextId = 'files.contract'
  runtime.pushContext({
    id: contextId,
    layer: 'focus',
    priority: 10,
    scopes: ['files.standalone', 'files.list'],
  })
  runtime.registerHandler(contextId, 'files.select_all', () => {
    if (!fileActionsEnabled || paths.length === 0) return 'fallthrough'
    state = {
      ...state,
      selectedPaths: paths,
      anchorPath: paths[0] ?? null,
    }
    return 'handled'
  })
  runtime.registerHandler(contextId, 'files.open_focused', () => {
    if (!fileActionsEnabled || !state.focusedPath) return 'fallthrough'
    commands.push(`open:${state.focusedPath}`)
    return 'handled'
  })
  runtime.registerHandler(contextId, 'files.rename_focused', () => {
    if (!fileActionsEnabled || !state.focusedPath) return 'fallthrough'
    commands.push(`rename:${state.focusedPath}`)
    return 'handled'
  })
  runtime.registerHandler(contextId, 'files.delete_selection', () => {
    if (!fileActionsEnabled || !state.focusedPath) return 'fallthrough'
    const selected = state.selectedPaths.includes(state.focusedPath)
      ? state.selectedPaths
      : [state.focusedPath]
    commands.push(`delete:${selected.join(',')}`)
    return 'handled'
  })

  const dispatch = (
    code: string,
    key: string,
    values: Partial<ShortcutKeyboardEventLike> = {},
  ) => {
    const result = runtime.dispatch({ type: 'keydown', code, key, ...values }, {
      adapterId: 'files-page',
      contextIds: [contextId],
      editable: false,
    })
    runtime.releaseKey(code)
    return result
  }

  assert.equal(dispatch('KeyA', 'a', { ctrlKey: true }).actionId, 'files.select_all')
  assert.deepEqual(state.selectedPaths, paths)
  assert.equal(dispatch('Enter', 'Enter').actionId, 'files.open_focused')
  assert.equal(dispatch('F2', 'F2').actionId, 'files.rename_focused')
  assert.equal(dispatch('Delete', 'Delete').actionId, 'files.delete_selection')
  assert.deepEqual(commands, [
    'open:/srv/beta.txt',
    'rename:/srv/beta.txt',
    'delete:/srv/alpha.txt,/srv/beta.txt,/srv/gamma.txt',
  ])

  const customBindings = setShortcutBindingOverride(
    {},
    'files.rename_focused',
    [createShortcutChord('F6', 'F6')],
  )
  runtime.updateIndex(compileShortcutIndex(customBindings, 'win32'))
  assert.equal(dispatch('F2', 'F2').reason, 'no_match')
  assert.equal(dispatch('F6', 'F6').actionId, 'files.rename_focused')

  fileActionsEnabled = false
  assert.equal(dispatch('KeyA', 'a', { ctrlKey: true }).result, 'fallthrough')

  state = applyFilesWorkspaceSelection(state, paths, paths[2], { contextMenu: true })
  assert.deepEqual(state.selectedPaths, paths)
  state = clearFilesWorkspaceSelection(state)
  assert.deepEqual(state.selectedPaths, [])
  assert.equal(state.focusedPath, paths[2])
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
    /if \(shortcutSettingsMutation\.current !== mutation\) \{\s*throw updateError\s*\}/,
  )
})
