import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const providerSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/runtime/TerminalRuntimeProvider.tsx', import.meta.url)),
  'utf8',
)
const reconciliationSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/runtime/completionStatusReconciler.ts', import.meta.url)),
  'utf8',
)
const viewportSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/ui/TerminalPaneViewport.tsx', import.meta.url)),
  'utf8',
)
const contextSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/runtime/terminalRuntimeContext.ts', import.meta.url)),
  'utf8',
)

test('终端容器变化时即时适配视口并在稳定后上报 PTY 尺寸', () => {
  const start = providerSource.indexOf('const scheduleSessionResize')
  const end = providerSource.indexOf('const scheduleActiveResize', start)
  const resizeSource = providerSource.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.match(resizeSource, /entry\.resizeFrame = window\.requestAnimationFrame/)
  assert.match(resizeSource, /fitEntryViewport\(entry\)/)
  assert.match(resizeSource, /entry\.resizeTimer = window\.setTimeout/)
  assert.match(resizeSource, /sendResize\(entry\)/)
  assert.ok(
    resizeSource.indexOf('requestAnimationFrame') < resizeSource.indexOf('setTimeout'),
    '本地视口适配应先于远端 PTY 尺寸上报',
  )
})

test('终端补全通过稳定外部存储订阅且不在渲染期发布设置变化', () => {
  assert.match(contextSource, /useSyncExternalStore\(subscribe, getSnapshot, getSnapshot\)/)
  assert.match(providerSource, /useEffect\(\(\) => \{\s*completionRuntime\.setEnabled\(completionSettings\.enabled\)/)
  assert.doesNotMatch(
    providerSource,
    /const completionRuntime = completionRuntimeRef\.current\s*\n\s*completionRuntime\.setEnabled/,
  )
  assert.match(providerSource, /completionRuntime\.invalidateProviderConfiguration\(\)/)
})

test('候选按键通过统一运行时解析并保持原生 Tab 与 Escape 语义', () => {
  assert.match(providerSource, /terminal\.attachCustomKeyEventHandler/)
  assert.match(providerSource, /shortcutRuntime\.dispatch\(event/)
  assert.match(providerSource, /'terminal\.completion\.previous'/)
  assert.match(providerSource, /'terminal\.completion\.next'/)
  assert.match(providerSource, /'terminal\.completion\.accept'/)
  assert.match(providerSource, /viewport\.completionVisible/)
  assert.match(
    providerSource,
    /acceptSelection\(sessionId\)[\s\S]*?acceptance\.exact[\s\S]*?isPlainTerminalEnter\(event\) \? 'fallthrough' : 'handled'[\s\S]*?sendTerminalInput\(acceptance\.text, 'none'\)/,
  )
  assert.doesNotMatch(providerSource, /acceptance\.text[\s\S]{0,80}ensureTerminalEnter/)
  assert.match(
    providerSource,
    /event\.key === 'Tab'[\s\S]*?completionRuntime\.closeSuggestions\(sessionId\)[\s\S]*?return true/,
  )
  assert.match(
    providerSource,
    /event\.key === 'Escape'[\s\S]*?completionRuntime\.closeSuggestions\(sessionId\)[\s\S]*?return false/,
  )
})

test('终端复制粘贴只有一个键盘所有者且无选区 Ctrl-C 透传', () => {
  assert.doesNotMatch(providerSource, /handleClipboardKey/)
  assert.doesNotMatch(providerSource, /sendTerminalInput\('\\x03'\)/)
  assert.match(
    providerSource,
    /'terminal\.copy_selection'[\s\S]*?!terminal\.hasSelection\(\)[\s\S]*?return 'fallthrough'/,
  )
  assert.match(
    providerSource,
    /'terminal\.paste'[\s\S]*?pasteEntryClipboard\(entry\)[\s\S]*?return 'handled'/,
  )
  assert.match(providerSource, /if \(!terminal\.hasSelection\(\)\) \{\s*return\s*\}/)
})

test('所有终端输入入口统一更新补全可信状态', () => {
  assert.match(providerSource, /completionRuntime\.applyUserData\(sessionId, data\)/)
  assert.match(providerSource, /completionRuntime\.applyBinaryInput\(sessionId\)/)
  assert.match(providerSource, /completionRuntime\.applyPaste\(entry\.sessionId, text\)/)
  assert.match(providerSource, /completionRuntime\.applyProgrammaticInput\(sessionId, text, options\)/)
  assert.match(providerSource, /completionRuntime\.startComposition\(sessionId\)/)
  assert.match(providerSource, /completionRuntime\.endComposition\(sessionId\)/)
  assert.match(providerSource, /completionRuntime\.setAlternateScreen\(sessionId, buffer\.type === 'alternate'\)/)
})

test('权威输入锁统一阻断用户、粘贴、补全与程序化写入但不阻断只读交互', () => {
  assert.match(providerSource, /const canAcceptTerminalInput = useCallback/)
  assert.match(providerSource, /isEntryWritable\(entry\) && !entry\.inputLock\.locked/)
  assert.match(providerSource, /const sendTerminalInput[\s\S]*?!canAcceptTerminalInput\(entry\)/)
  assert.match(providerSource, /const pasteEntryText[\s\S]*?!canAcceptTerminalInput\(entry\)/)
  assert.match(providerSource, /const sendTextToSession[\s\S]*?!canAcceptTerminalInput\(entry\)/)
  assert.match(providerSource, /const acceptSessionCompletion[\s\S]*?!canAcceptTerminalInput\(entry\)/)
  assert.match(providerSource, /entry\.transport\.sendCwdChange[\s\S]*?entry\.transport\.sendCwdRefresh/)
  assert.match(providerSource, /entry\.terminal\.options\.disableStdin = next\.locked/)
  assert.match(providerSource, /case 'input_lock':\s*return/)
  assert.doesNotMatch(providerSource, /copyEntrySelection[\s\S]{0,120}canAcceptTerminalInput/)
})

test('缺少提示符时有界对账补全状态并在生命周期变化时停止', () => {
  assert.match(reconciliationSource, /sessionCompletionStatus\(sessionId/)
  assert.match(reconciliationSource, /completionStatusRetryDelays/)
  assert.match(
    providerSource,
    /event\.type === 'prompt_boundary'[\s\S]*?stopCompletionStatusReconciliation\(sessionId\)/,
  )
  assert.match(
    providerSource,
    /event\.state !== 'live'[\s\S]*?stopCompletionStatusReconciliation\(sessionId\)/,
  )
  assert.match(viewportSource, /terminal-completion-notice/)
  assert.match(viewportSource, /completionNotice === 'reconnect_required'/)
  assert.match(reconciliationSource, /refreshSessionCompletions\(sessionId/)
  assert.match(viewportSource, /completion\.promptObservation\.retryable/)
  assert.match(reconciliationSource, /markPromptObservationUnavailable\(sessionId\)/)
  assert.match(viewportSource, /result === 'failed'/)
})

test('候选只在活动工作区显示并与搜索及右键菜单互斥', () => {
  assert.match(viewportSource, /shouldActivateTerminalCompletionViewport/)
  assert.match(viewportSource, /closeSessionCompletion\(session\.id\)[\s\S]*?captureSessionContext/)
  assert.match(viewportSource, /setViewportCompletionActive\(paneId, sessionId, interactionActive\)/)
  assert.match(
    viewportSource,
    /setViewportCompletionVisible\(paneId, sessionId, visible\)/,
  )
  assert.match(viewportSource, /<TerminalCompletionPopup[\s\S]*?position=\{completionPosition\}/)
  assert.match(viewportSource, /<TerminalCompletionPopup[\s\S]*?themeMode=\{themeMode\}/)
  assert.match(providerSource, /transitionTerminalCompletionActivity/)
  assert.match(
    viewportSource,
    /return \(\) => \{\s*setViewportCompletionActive\(paneId, sessionId, false\)\s*\}/,
  )
})
