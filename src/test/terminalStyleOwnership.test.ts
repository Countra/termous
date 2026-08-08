import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const legacyStyles = readSource('../shared/styles/workstation.scss')
const globalStyles = readSource('../shared/styles/global.scss')

test('终端与会话样式不再由旧工作台全局层承载', () => {
  for (const className of [
    'session-tabs-shell',
    'session-tab-button',
    'session-quick-connect-popover',
    'context-action-menu',
    'termous-popconfirm',
    'terminal-context-menu',
    'terminal-split-workspace',
    'terminal-snap-layer',
    'terminal-pane-frame',
    'terminal-canvas',
    'terminal-session-pane',
    'terminal-runtime-parking',
    'terminal-disconnect-overlay',
    'terminal-search-panel',
    'terminal-toolbar',
    'connection-progress',
    'connection-action-button',
  ]) {
    assert.doesNotMatch(legacyStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }
})

test('终端与会话组件显式加载各自的 SCSS Module', () => {
  const owners = [
    ['../shared/ui/SessionTabStrip.tsx', './SessionTabs.module.scss', "styles['session-tabs-shell']"],
    ['../shared/ui/SessionTabButton.tsx', './SessionTabs.module.scss', "styles['session-tab-button']"],
    ['../features/hosts/ui/SessionQuickConnect.tsx', './SessionQuickConnect.module.scss', 'styles.popover'],
    ['../shared/ui/contextActionMenuStyles.ts', './ContextActionMenu.module.scss', 'styles.root'],
    ['../shared/ui/termousPopconfirm.ts', './TermousPopconfirm.module.scss', 'styles.root'],
    ['../features/terminal/ui/TerminalContextMenu.tsx', './TerminalContextMenu.module.scss', 'styles.root'],
    ['../features/terminal/ui/TerminalSplitWorkspace.tsx', './TerminalSplitWorkspace.module.scss', 'styles.workspace'],
    ['../features/terminal/ui/TerminalPaneViewport.tsx', './TerminalPaneViewport.module.scss', 'styles.frame'],
    ['../features/terminal/runtime/TerminalRuntimeProvider.tsx', './TerminalRuntimeProvider.module.scss', 'styles.parking'],
    ['../features/terminal/ui/TerminalSearchPanel.tsx', './TerminalSearchPanel.module.scss', 'styles.panel'],
    ['../features/terminal/ui/ConnectionProgress.tsx', './ConnectionProgress.module.scss', "styles['connection-progress']"],
    ['../widgets/workbench/ui/WorkbenchTerminalPanel.tsx', './WorkbenchPage.module.scss', "styles['terminal-toolbar-status']"],
  ] as const

  for (const [sourcePath, stylePath, classReference] of owners) {
    const source = readSource(sourcePath)
    assert.match(source, new RegExp(`import styles from '${escapeRegExp(stylePath)}'`))
    assert.ok(source.includes(classReference), `${sourcePath} 未使用 ${classReference}`)
  }

  const connectionButtonSource = readSource('../shared/ui/ConnectionActionButton.tsx')
  assert.match(
    connectionButtonSource,
    /import \{ connectionActionButtonClassName \} from '\.\/connectionActionButtonStyles'/,
  )
  assert.match(connectionButtonSource, /\[connectionActionButtonClassName,/)
})

test('第三方覆盖和跨 Portal 拖拽状态保留受控边界', () => {
  const contextMenuStyles = readSource('../shared/ui/ContextActionMenu.module.scss')
  const terminalContextMenuStyles = readSource('../features/terminal/ui/TerminalContextMenu.module.scss')
  const terminalRuntimeStyles = readSource('../features/terminal/runtime/TerminalRuntimeProvider.module.scss')
  const connectionButtonStyles = readSource('../shared/ui/ConnectionActionButton.module.scss')

  assert.match(contextMenuStyles, /\.root :global\(\.ant-dropdown-menu\)/)
  assert.match(terminalContextMenuStyles, /\.root :global\(\.ant-dropdown-menu-item\)/)
  assert.match(terminalRuntimeStyles, /\.pane :global\(\.xterm\)/)
  assert.match(
    connectionButtonStyles,
    /\.button:global\(\.ant-btn\):not\(:disabled\):hover/,
  )
  assert.match(globalStyles, /body\[data-terminal-tab-dragging='true'\]/)
  assert.doesNotMatch(legacyStyles, /data-terminal-tab-dragging/)
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
