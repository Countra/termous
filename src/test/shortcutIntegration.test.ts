import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appSource = readFileSync(
  fileURLToPath(new URL('../App.tsx', import.meta.url)),
  'utf8',
)
const shortcutProviderSource = readFileSync(
  fileURLToPath(new URL('../features/shortcuts/ShortcutRuntimeProvider.tsx', import.meta.url)),
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

test('主机连接入口只通过统一窗口快捷键适配器触发', () => {
  assert.match(appSource, /<ShortcutRuntimeProvider settings=\{data\.settings\.shortcuts\}>/)
  assert.match(
    appSource,
    /<ShortcutWindowAdapter handlers=\{\{[\s\S]*?'app\.host_launcher\.open'[\s\S]*?openContextualHostLauncher\(\)/,
  )
  assert.doesNotMatch(appSource, /isHostLauncherShortcut/)
  assert.doesNotMatch(appSource, /addEventListener\('keydown'/)
})

test('窗口适配器让 xterm 独占终端按键，避免同一动作解析两次', () => {
  assert.match(terminalViewportSource, /data-shortcut-adapter="xterm"/)
  assert.match(shortcutProviderSource, /isOwnedByShortcutAdapter\(event\.target\)/)
  assert.match(shortcutProviderSource, /closest\('\[data-shortcut-adapter\]'\)/)
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
