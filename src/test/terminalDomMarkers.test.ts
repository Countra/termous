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
  const closestSelectors = readClosestSelectors(viewportSource)
  for (const selector of [
    '[data-terminal-search-panel]',
    '[data-terminal-ai-completion]',
    '${terminalContextMenuSelector}',
  ]) {
    assert.ok(closestSelectors.some((selectors) => selectors.includes(selector)), `缺少终端交互选择器: ${selector}`)
  }
  const menuSelector = contextMenuSource.match(/terminalContextMenuSelector\s*=\s*`([^`]+)`/)?.[1]
  assert.ok(menuSelector, '缺少终端菜单选择器定义')
  for (const selector of ['[data-terminal-context-menu]', '.${terminalContextMenuPopupMarker}']) {
    assert.ok(menuSelector.split(',').map((part) => part.trim()).includes(selector), `缺少终端菜单标记: ${selector}`)
  }
  assert.match(splitWorkspaceSource, /closest<HTMLElement>\('\[data-terminal-pane-frame\]\[data-pane-id\]'\)/)

  for (const selector of [...closestSelectors, ...readClosestSelectors(splitWorkspaceSource)].flat()) {
    assert.doesNotMatch(selector, /\.terminal-(?:search-panel|context-menu|pane-frame)\b/)
  }
})

test('终端 DOM marker 与局部样式解耦并保留第三方 xterm 查询', () => {
  assert.match(searchPanelSource, /import styles from '\.\/TerminalSearchPanel\.module\.scss'/)
  assert.match(searchPanelSource, /className=\{\[styles\.panel,/)
  assert.match(contextMenuSource, /import styles from '\.\/TerminalContextMenu\.module\.scss'/)
  for (const expression of [
    contextMenuSource.match(/classNames=\{\{\s*root:\s*`([^`]+)`\s*\}\}/)?.[1],
    contextMenuSource.match(/rootClassName:\s*`([^`]+)`/)?.[1],
  ]) {
    assert.ok(expression, '菜单及独立子菜单必须声明浮层类名')
    const classNames = expression.split(/\s+/)
    for (const className of ['${contextActionMenuPopupClassName}', '${styles.root}', '${terminalContextMenuPopupMarker}']) {
      assert.ok(classNames.includes(className), `缺少终端菜单浮层类名: ${className}`)
    }
  }
  assert.match(viewportSource, /import styles from '\.\/TerminalPaneViewport\.module\.scss'/)
  assert.match(viewportSource, /className=\{\[\s*styles\.frame,/)
  assert.match(splitWorkspaceSource, /import styles from '\.\/TerminalSplitWorkspace\.module\.scss'/)
  assert.match(splitWorkspaceSource, /className=\{\[styles\.workspace,/)
  assert.match(viewportSource, /querySelector\('\.xterm-helper-textarea'\)/)
})

function readClosestSelectors(source: string) {
  return Array.from(
    source.matchAll(/\.closest(?:<[^>]+>)?\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*\)/g),
    ([, literal]) => literal.slice(1, -1).split(',').map((part) => part.trim()),
  )
}

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}
