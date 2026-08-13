import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const workbenchSource = readFileSync(
  fileURLToPath(new URL('../widgets/workbench/ui/WorkbenchPage.tsx', import.meta.url)),
  'utf8',
)
const searchPanelSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/ui/TerminalSearchPanel.tsx', import.meta.url)),
  'utf8',
)

test('终端搜索副作用不在 React 状态 updater 中执行', () => {
  assert.equal((workbenchSource.match(/setTerminalSearchState\(/g) ?? []).length, 1)
  assert.doesNotMatch(workbenchSource, /setTerminalSearchState\(\s*\(/)
  assert.match(workbenchSource, /const result = searchActive\([\s\S]*?commitTerminalSearch\(\{ \.\.\.current, result \}\)/)
})

test('终端搜索输入只保留单一 React 变更入口', () => {
  assert.equal((searchPanelSource.match(/\bonChange=\{/g) ?? []).length, 1)
  assert.doesNotMatch(searchPanelSource, /\bonInput=\{|\bonKeyUp=\{|addEventListener\(['"](?:input|keyup)['"]/)
  assert.match(searchPanelSource, /nativeEvent\.isComposing/)
})

test('跨会话搜索会清理旧高亮并限制待处理请求生命周期', () => {
  assert.match(workbenchSource, /current\.sessionId && current\.sessionId !== sessionId[\s\S]*?clearActiveSearch\(current\.sessionId\)/)
  assert.match(workbenchSource, /sourceSessionId: activeSession\?\.id \?\? null/)
  assert.match(workbenchSource, /activeSessionId !== pendingSearchRequest\.sourceSessionId/)
})
