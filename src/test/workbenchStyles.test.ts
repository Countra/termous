import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const pageStyles = readSource('../widgets/workbench/ui/WorkbenchPage.module.scss')
const sessionStyles = readSource('../widgets/workbench/ui/WorkbenchSessionTabs.module.scss')
const detailsStyles = readSource('../widgets/workbench/ui/WorkbenchDetails.module.scss')
const sessionTabButtonSource = readSource('../shared/ui/SessionTabButton.tsx')
const sessionTabStripSource = readSource('../shared/ui/SessionTabStrip.tsx')
const workbenchSessionTabsSource = readSource('../widgets/workbench/ui/WorkbenchSessionTabs.tsx')
const workbenchPageSource = readSource('../widgets/workbench/ui/WorkbenchPage.tsx')
const workbenchTerminalPanelSource = readSource('../widgets/workbench/ui/WorkbenchTerminalPanel.tsx')
const commandDispatchDockStyles = readSource('../features/command-dispatch/ui/CommandDispatchDock.module.scss')

test('工作台模块保留终端布局与响应式合同', () => {
  assert.match(
    pageStyles,
    /\.workbench-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--workbench-details-layout-width\);/s,
  )
  assert.match(
    pageStyles,
    /\.terminal-card\s*\{[^}]*grid-template-rows:\s*42px auto minmax\(0, 1fr\) auto 36px;/s,
  )
  assert.match(
    pageStyles,
    /\.terminal-statusbar\s*\{[^}]*repeat\(3, minmax\(72px, 0\.75fr\)\)\s*auto;/s,
  )
  assert.match(
    pageStyles,
    /@media \(width <= 1240px\)\s*\{[\s\S]*?--workbench-details-layout-width:\s*clamp\(214px, var\(--workbench-details-width, 238px\), 238px\);[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 64px;/,
  )
  assert.match(
    pageStyles,
    /@media \(width <= 1180px\)\s*\{[\s\S]*?\.terminal-workspace\s*\{[^}]*min-height:\s*680px;/,
  )
})

test('工作台模块保留 Portal 边界与详情树层级', () => {
  assert.match(
    sessionStyles,
    /\.terminal-tab-dropdown :global\(\.ant-dropdown-menu\)/,
  )
  assert.match(
    sessionStyles,
    /\.session-tab-color-popover :global\(\.ant-popover-inner\)/,
  )
  assert.match(
    detailsStyles,
    /\.system-info-tree-node\.level-2 \.system-info-tree-row\s*\{[^}]*grid-template-columns:\s*minmax\(48px, 0\.42fr\) minmax\(0, 1fr\);/s,
  )
  assert.match(
    detailsStyles,
    /\.current-connection-actions :global\(\.ant-btn\)\s*\{[^}]*width:\s*100%;/s,
  )
  assert.match(
    detailsStyles,
    /\.connection-overview-icon:global\(\.host-avatar\)\s*\{/,
  )
})

test('会话标签行为使用稳定数据标记而不读取内部样式类名', () => {
  for (const marker of [
    'data-session-tab-root',
    'data-session-tab-main',
    'data-session-tab-close',
  ]) {
    assert.match(sessionTabButtonSource, new RegExp(marker))
  }
  assert.match(sessionTabStripSource, /data-session-tab-scroll-direction/)
  assert.match(workbenchPageSource, /closest\('\[data-session-tab-close\]'\)/)
  assert.match(workbenchPageSource, /document\.body\.dataset\.terminalTabDragging = 'true'/)
  assert.match(workbenchPageSource, /delete document\.body\.dataset\.terminalTabDragging/)
  assert.doesNotMatch(workbenchPageSource, /classList\.(?:add|remove)\('is-terminal-tab-dragging'\)/)

  const behaviorSources = [sessionTabButtonSource, sessionTabStripSource, workbenchPageSource].join('\n')
  assert.doesNotMatch(
    behaviorSources,
    /(?:closest|querySelector)(?:<[^>]+>)?\('\.(?:session-tab-button|session-tab-main|session-tab-close)'/,
  )
  assert.doesNotMatch(
    behaviorSources,
    /classList\.contains\('(?:session-scroll-button|is-left|is-right)'\)/,
  )
})

test('会话标签不展示命令台任务状态', () => {
  assert.doesNotMatch(workbenchSessionTabsSource, /commandTargetStatuses/)
  assert.doesNotMatch(workbenchSessionTabsSource, /data-command-dispatch-tab-status/)
  assert.doesNotMatch(sessionStyles, /command-status-/)
})

test('会话命令台使用内嵌底部抽屉完成展开和折叠', () => {
  assert.match(workbenchTerminalPanelSource, /import \{ Drawer \} from 'antd'/)
  assert.match(workbenchTerminalPanelSource, /<Drawer[\s\S]*?placement="bottom"/)
  assert.match(workbenchTerminalPanelSource, /getContainer=\{false\}/)
  assert.match(workbenchTerminalPanelSource, /mask=\{false\}/)
  assert.match(workbenchTerminalPanelSource, /destroyOnHidden/)
  assert.doesNotMatch(workbenchTerminalPanelSource, /commandDockOpen \? commandDock : null/)
  assert.match(
    pageStyles,
    /\.terminal-command-drawer:global\(\.ant-drawer\)\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow:\s*hidden;/s,
  )
  assert.match(
    pageStyles,
    /\.terminal-command-dock-slot\s*\{[^}]*height:\s*0;[^}]*overflow:\s*hidden;[^}]*transition:\s*height 180ms/s,
  )
  assert.match(
    pageStyles,
    /\.terminal-command-dock-slot\.is-open\s*\{[^}]*height:\s*var\(--terminal-command-drawer-height\);/s,
  )
  assert.match(workbenchTerminalPanelSource, /commandDockOpen \? styles\['is-open'\] : ''/)
  assert.match(workbenchTerminalPanelSource, /background: 'var\(--terminal-frame\)'/)
  assert.match(workbenchTerminalPanelSource, /transitionDuration: '180ms'/)
  assert.match(workbenchTerminalPanelSource, /transitionProperty: 'transform'/)
  assert.match(commandDispatchDockStyles, /\.root\s*\{[^}]*background:\s*var\(--terminal-frame\);/s)
  assert.doesNotMatch(
    commandDispatchDockStyles,
    /\.root\s*\{[^}]*background:\s*color-mix\([^}]*var\(--terminal-toolbar\)/s,
  )
})
