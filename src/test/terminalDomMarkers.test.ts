import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const viewportSource = readSource('../features/terminal/ui/TerminalPaneViewport.tsx')
const splitWorkspaceSource = readSource('../features/terminal/ui/TerminalSplitWorkspace.tsx')
const searchPanelSource = readSource('../features/terminal/ui/TerminalSearchPanel.tsx')
const contextMenuSource = readSource('../features/terminal/ui/TerminalContextMenu.tsx')

test('终端内部交互使用稳定 DOM marker 而不是业务样式类名', () => {
  assert.match(searchPanelSource, /data-terminal-search-panel=""/)
  assert.match(contextMenuSource, /'data-terminal-context-menu': ''/)
  assert.match(viewportSource, /data-terminal-pane-frame=""/)
  assert.match(viewportSource, /closest\('\[data-terminal-search-panel\]'\)/)
  assert.match(viewportSource, /closest\('\[data-terminal-context-menu\]'\)/)
  assert.match(splitWorkspaceSource, /closest<HTMLElement>\('\[data-terminal-pane-frame\]\[data-pane-id\]'\)/)

  assert.doesNotMatch(viewportSource, /closest\('\.terminal-(?:search-panel|context-menu)'\)/)
  assert.doesNotMatch(splitWorkspaceSource, /closest<HTMLElement>\('\.terminal-pane-frame/)
})

test('终端 DOM marker 解耦不改变样式类名和第三方 xterm 查询', () => {
  assert.match(searchPanelSource, /className=\{`terminal-search-panel/)
  assert.match(contextMenuSource, /classNames=\{\{ root: 'terminal-context-menu context-action-menu' \}\}/)
  assert.match(viewportSource, /className=\{`terminal-pane-frame/)
  assert.match(viewportSource, /querySelector\('\.xterm-helper-textarea'\)/)
})

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}
