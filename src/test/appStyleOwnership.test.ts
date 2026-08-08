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

test('共享操作按钮与设置页标题不再依赖全局基础选择器', () => {
  const primitiveStyles = source('../shared/ui/Primitives.module.scss')
  const settingsStyles = source('../pages/settings/ui/SettingsPage.module.scss')
  const settingsSource = source('../pages/settings/ui/SettingsPage.tsx')
  const legacyStyles = source('../shared/main-styles/workstation.scss')

  for (const className of ['primary-button', 'secondary-button', 'danger-button']) {
    assert.match(primitiveStyles, new RegExp(`\\.${className}:global\\(\\.ant-btn\\)`))
    assert.doesNotMatch(legacyStyles, new RegExp(`^\\.${className}\\.ant-btn`, 'm'))
  }

  assert.match(primitiveStyles, /\.page-actions\s*\{[^}]*gap:\s*8px;/s)
  assert.match(primitiveStyles, /--main-action-bg-active:/)
  assert.doesNotMatch(legacyStyles, /^\.page-actions\s*\{/m)

  assert.match(settingsStyles, /\.page-title-row\s*\{[^}]*align-items:\s*center;/s)
  assert.match(settingsStyles, /\.page-title-row h1\s*\{[^}]*font-size:\s*22px;[^}]*font-weight:\s*760;/s)
  assert.match(settingsSource, /className=\{styles\['page-title-row'\]\}/)
  assert.doesNotMatch(settingsSource, /styles\['page-title-row'\][^\n]*page-title-row/)
  assert.doesNotMatch(legacyStyles, /^\.page-title-row(?:\s|\{)/m)
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

test('侧栏框架与折叠控件由共享 Module 承载', () => {
  const controlsStyles = source('../shared/ui/SidePanelControls.module.scss')
  const featureSidePanelSource = source('../shared/ui/FeatureSidePanel.tsx')
  const hostContextPanelSource = source('../features/hosts/ui/HostContextPanel.tsx')
  const hostContextPanelStyles = source('../features/hosts/ui/HostContextPanel.module.scss')
  const publicEntry = source('../shared/ui/index.ts')
  const legacyStyles = source('../shared/main-styles/workstation.scss')

  for (const className of [
    'panel',
    'is-collapsed',
    'is-resizing',
    'resize-edge',
    'resize-edge-left',
    'resize-edge-right',
    'panel-side-toggle',
    'panel-side-toggle-left',
    'panel-side-toggle-right',
  ]) {
    assert.match(controlsStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }

  assert.match(publicEntry, /default as sidePanelStyles.*SidePanelControls\.module\.scss/)
  assert.match(featureSidePanelSource, /import sidePanelStyles from '\.\/SidePanelControls\.module\.scss'/)
  assert.match(hostContextPanelSource, /import \{ EmptyState, sidePanelStyles \} from '#shared\/ui'/)

  assert.match(hostContextPanelStyles, /\.host-context-panel\.is-content-collapsed/)
  assert.match(legacyStyles, /^body\[data-panel-resizing='true'\]\s*\{/m)
  assert.doesNotMatch(legacyStyles, /^\.(?:context-panel|details-panel)(?=[\s.,:{])/m)
  assert.doesNotMatch(legacyStyles, /^\.(?:host-context-resize-edge|details-resize-edge)(?=[\s.,:{])/m)
  assert.doesNotMatch(legacyStyles, /^\.panel-side-toggle(?:\b|-)/m)
  assert.doesNotMatch(legacyStyles, /^\.host-context-panel\.is-(?:content-collapsed|resizing)\b/m)
  assert.doesNotMatch(legacyStyles, /^\.host-context-panel\.is-collapsed \.panel-heading\b/m)
  assert.doesNotMatch(legacyStyles, /^\.panel-heading(?:\s|\{)/m)
})
