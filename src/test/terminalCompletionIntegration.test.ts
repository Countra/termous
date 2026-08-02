import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const providerSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/TerminalRuntimeProvider.tsx', import.meta.url)),
  'utf8',
)
const viewportSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/TerminalPaneViewport.tsx', import.meta.url)),
  'utf8',
)
const contextSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/terminalRuntimeContext.ts', import.meta.url)),
  'utf8',
)

test('终端补全通过稳定外部存储订阅且不在渲染期发布设置变化', () => {
  assert.match(contextSource, /useSyncExternalStore\(subscribe, getSnapshot, getSnapshot\)/)
  assert.match(providerSource, /useEffect\(\(\) => \{\s*completionRuntime\.setEnabled\(completionSettings\.enabled\)/)
  assert.doesNotMatch(
    providerSource,
    /const completionRuntime = completionRuntimeRef\.current\s*\n\s*completionRuntime\.setEnabled/,
  )
})

test('候选按键仅拦截活动补全并保持原生 Tab 透传', () => {
  assert.match(providerSource, /terminal\.attachCustomKeyEventHandler/)
  assert.match(providerSource, /!isCompletionInteractionActive\(sessionId\)/)
  assert.match(providerSource, /viewport\.completionVisible/)
  assert.match(
    providerSource,
    /case 'Enter':[\s\S]*?acceptSelection\(sessionId\)[\s\S]*?sendTerminalInput\(acceptance\.text, 'none'\)[\s\S]*?return false/,
  )
  assert.doesNotMatch(providerSource, /acceptance\.text[\s\S]{0,80}ensureTerminalEnter/)
  assert.match(
    providerSource,
    /case 'Tab':\s*completionRuntime\.closeSuggestions\(sessionId\)\s*return true/,
  )
  assert.match(
    providerSource,
    /event\.key !== 'Tab'[\s\S]*?event\.ctrlKey \|\| event\.altKey \|\| event\.metaKey \|\| event\.shiftKey[\s\S]*?return true/,
  )
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

test('候选只在活动工作区显示并与搜索及右键菜单互斥', () => {
  assert.match(viewportSource, /shouldActivateTerminalCompletionViewport/)
  assert.match(viewportSource, /closeSessionCompletion\(session\.id\)[\s\S]*?captureSessionContext/)
  assert.match(viewportSource, /setViewportCompletionActive\(paneId, sessionId, interactionActive\)/)
  assert.match(
    viewportSource,
    /setViewportCompletionVisible\(paneId, sessionId, visible\)/,
  )
  assert.match(viewportSource, /<TerminalCompletionPopup[\s\S]*?position=\{completionPosition\}/)
  assert.match(providerSource, /transitionTerminalCompletionActivity/)
  assert.match(
    viewportSource,
    /return \(\) => \{\s*setViewportCompletionActive\(paneId, sessionId, false\)\s*\}/,
  )
})
