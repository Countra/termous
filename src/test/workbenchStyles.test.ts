import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const legacyStyles = [
  readSource('../shared/styles/app.scss'),
  readSource('../shared/styles/workstation.scss'),
].join('\n')
const pageStyles = readSource('../widgets/workbench/ui/WorkbenchPage.module.scss')
const sessionStyles = readSource('../widgets/workbench/ui/WorkbenchSessionTabs.module.scss')
const detailsStyles = readSource('../widgets/workbench/ui/WorkbenchDetails.module.scss')

test('工作台独占选择器不再由旧全局样式承载', () => {
  for (const className of [
    'page-grid',
    'workbench-grid',
    'terminal-workspace',
    'terminal-card',
    'terminal-progress-slot',
    'terminal-empty-connect',
    'terminal-empty-connect-button',
    'terminal-statusbar',
    'terminal-status-item',
    'session-tab-trigger',
    'session-tab-color-popover',
    'session-tab-color-panel',
    'session-tab-color-grid',
    'session-tab-color-swatch',
    'session-tab-color-actions',
    'terminal-tab-dropdown',
    'terminal-tab-menu-item',
    'terminal-tab-menu-icon',
    'terminal-tab-menu-label',
    'connection-overview-panel',
    'connection-overview-hero',
    'connection-overview-icon',
    'connection-overview-copy',
    'connection-overview-tags-cell',
    'connection-overview-tags',
    'detail-list',
    'current-connection-actions',
    'system-info-loading',
    'system-info-panel',
    'system-info-summary',
    'system-info-platform',
    'system-info-tree',
    'system-info-tree-node',
    'system-info-tree-row',
    'system-info-tree-label',
    'system-info-tree-toggle',
    'system-info-tree-icon',
    'system-info-tree-value',
    'system-info-tree-children',
  ]) {
    assert.doesNotMatch(legacyStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }
})

test('工作台模块保留终端布局与响应式合同', () => {
  assert.match(
    pageStyles,
    /\.workbench-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--workbench-details-layout-width\);/s,
  )
  assert.match(
    pageStyles,
    /\.terminal-card\s*\{[^}]*grid-template-rows:\s*42px auto minmax\(0, 1fr\) 36px;/s,
  )
  assert.match(
    pageStyles,
    /\.terminal-statusbar\s*\{[^}]*repeat\(3, minmax\(72px, 0\.75fr\)\);/s,
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
