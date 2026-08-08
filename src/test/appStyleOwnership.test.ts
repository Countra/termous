import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

test('主界面入口不再加载 app 全局业务样式', () => {
  const appStylePath = fileURLToPath(new URL('../shared/styles/app.scss', import.meta.url))
  const mainStyles = source('../shared/main-styles/index.ts')

  assert.equal(existsSync(appStylePath), false)
  assert.doesNotMatch(mainStyles, /app\.scss/)
  assert.match(mainStyles, /import '\.\/workstation\.scss'/)
})

test('共享控件基础样式通过显式 Module 合同消费', () => {
  const primitiveStyles = source('../shared/ui/Primitives.module.scss')
  const publicEntry = source('../shared/ui/index.ts')

  for (const className of [
    'primary-button',
    'secondary-button',
    'danger-button',
    'page-actions',
    'field-label',
    'is-spinning',
  ]) {
    assert.match(primitiveStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }
  assert.match(publicEntry, /default as uiStyles.*Primitives\.module\.scss/)

  for (const relativePath of [
    '../features/firewall/ui/FirewallPersistencePanel.tsx',
    '../features/forwards/ui/ForwardManagementWorkspace.tsx',
    '../features/alias/ui/AliasSyncModal.tsx',
    '../widgets/files-workspace/ui/FilesWorkspace.tsx',
  ]) {
    assert.match(source(relativePath), /uiStyles\[/)
  }
})

test('原 app 业务选择器由组件共置 Module 承载', () => {
  const owners = [
    ['../shared/ui/ConfirmDialog.tsx', './ConfirmDialog.module.scss', 'confirm-dialog'],
    ['../shared/ui/CustomSelect.tsx', './CustomSelect.module.scss', 'custom-select'],
    ['../shared/ui/EmptyState.tsx', './EmptyState.module.scss', 'empty-state'],
    ['../shared/ui/FeatureSidePanel.tsx', './FeatureSidePanel.module.scss', 'details-panel'],
    ['../shared/ui/StatusBadge.tsx', './StatusBadge.module.scss', 'status-badge'],
    ['../shared/ui/WorkspaceEmptyState.tsx', './WorkspaceEmptyState.module.scss', 'workbench-empty-state'],
    ['../entities/host/ui/AuthMethodBadge.tsx', './AuthMethodBadge.module.scss', 'host-auth-badge'],
    ['../entities/host/ui/HostAvatar.tsx', './HostAvatar.module.scss', 'host-avatar'],
    ['../features/hosts/ui/HostContextPanel.tsx', './HostContextPanel.module.scss', 'host-context-panel'],
    ['../features/terminal/ui/ConnectionProgress.tsx', './ConnectionProgress.module.scss', 'connection-progress'],
    ['../features/terminal/ui/TerminalPaneViewport.tsx', './TerminalPaneViewport.module.scss', 'terminal-canvas'],
  ] as const

  for (const [relativePath, styleImport, className] of owners) {
    const componentSource = source(relativePath)
    assert.match(componentSource, new RegExp(`import styles from '${styleImport.replace('.', '\\.').replace('/', '\\/')}'`))
    assert.match(componentSource, new RegExp(`styles\\['${className}'\\]`))
  }

  const workspaceEmptyStateStyles = source('../shared/ui/WorkspaceEmptyState.module.scss')
  for (const className of [
    'workbench-empty-state',
    'workbench-empty-state-icon',
    'workbench-empty-state-description',
    'workbench-empty-state-action',
    'is-warning',
    'is-danger',
  ]) {
    assert.match(workspaceEmptyStateStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }
  assert.doesNotMatch(source('../shared/main-styles/workstation.scss'), /^\.workbench-empty-state(?:\b|-)/m)

  const statusBadgeStyles = source('../shared/ui/StatusBadge.module.scss')
  assert.match(statusBadgeStyles, /\.status-badge\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s)
  assert.doesNotMatch(source('../shared/main-styles/workstation.scss'), /^\.status-badge\s*\{/m)

  const authMethodBadgeStyles = source('../entities/host/ui/AuthMethodBadge.module.scss')
  for (const className of [
    'host-auth-badge',
    'host-auth-badge-label',
    'host-auth-badge-icon',
  ]) {
    assert.match(authMethodBadgeStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }

  const legacyStyles = source('../shared/main-styles/workstation.scss')
  assert.doesNotMatch(legacyStyles, /^\.host-auth-badge(?:\b|\s|\.)/m)
  assert.match(legacyStyles, /^\.data-row \.row-trailing > \.host-auth-badge\s*\{/m)
})

test('详情侧栏的折叠轨道与 Tabs Portal 样式由共置 Module 承载', () => {
  const featureSidePanelStyles = source('../shared/ui/FeatureSidePanel.module.scss')
  const legacyStyles = source('../shared/main-styles/workstation.scss')

  for (const className of [
    'details-collapsed-rail',
    'details-rail-tab',
    'details-content-shell',
    'details-tabs',
    'details-tabs-dropdown',
    'is-active',
    'is-hidden',
  ]) {
    assert.match(featureSidePanelStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
    assert.doesNotMatch(legacyStyles, new RegExp(`^\\.${className}(?=[\\s.:,{])`, 'm'))
  }

  assert.match(featureSidePanelStyles, /\.details-tabs:global\(\.ant-tabs\)/)
  assert.match(featureSidePanelStyles, /\.details-tabs-dropdown:global\(\.ant-tabs-dropdown\)/)
})
