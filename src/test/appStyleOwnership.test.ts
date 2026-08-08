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
    'field',
    'field-label',
    'search-input',
    'tooltip',
    'is-spinning',
  ]) {
    assert.match(primitiveStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }
  assert.match(publicEntry, /default as uiStyles.*Primitives\.module\.scss/)
  assert.match(publicEntry, /default as customSelectStyles.*CustomSelect\.module\.scss/)
  assert.match(publicEntry, /default as confirmDialogStyles.*ConfirmDialog\.module\.scss/)

  for (const relativePath of [
    '../features/firewall/ui/FirewallPersistencePanel.tsx',
    '../features/forwards/ui/ForwardManagementWorkspace.tsx',
    '../features/alias/ui/AliasSyncModal.tsx',
    '../widgets/files-workspace/ui/FilesWorkspace.tsx',
  ]) {
    assert.match(source(relativePath), /uiStyles\[/)
  }
})

test('共享表单和弹层样式通过显式 Module root 消费', () => {
  const legacyStyles = source('../shared/main-styles/workstation.scss')
  const primitiveStyles = source('../shared/ui/Primitives.module.scss')
  const customSelectStyles = source('../shared/ui/CustomSelect.module.scss')
  const confirmDialogStyles = source('../shared/ui/ConfirmDialog.module.scss')
  const emptyStateStyles = source('../shared/ui/EmptyState.module.scss')

  assert.match(primitiveStyles, /\.field\s*\{[^}]*align-content:\s*start;[^}]*gap:\s*6px;/s)
  assert.match(primitiveStyles, /\.search-input:global\(\.ant-input-affix-wrapper\)/)
  assert.match(primitiveStyles, /\.tooltip:global\(\.ant-tooltip\)/)
  assert.match(customSelectStyles, /\.select-popup:global\(\.ant-select-dropdown\)/)
  assert.match(customSelectStyles, /\.select-dropdown:global\(\.ant-select-dropdown\)/)
  assert.match(confirmDialogStyles, /\.modal-root\s*\{[^}]*z-index:\s*3600;/s)
  assert.match(confirmDialogStyles, /\.modal\s+:global\(\.ant-modal-content\)/)
  assert.match(emptyStateStyles, /\.empty-state\s*\{[^}]*min-height:\s*170px;[^}]*background:\s*var\(--surface-subtle\);/s)

  for (const selector of [
    'field',
    'field-label',
    'select-option-content',
    'empty-state',
    'confirm-modal-wrap',
    'confirm-modal',
    'confirm-dialog',
    'dialog-icon',
    'dialog-copy',
    'dialog-actions',
    'termous-select-dropdown',
  ]) {
    assert.doesNotMatch(legacyStyles, new RegExp(`^\\.${selector}(?=[\\s.,:{])`, 'm'))
  }

  assert.match(source('../features/docker/ui/DockerPanel.tsx'), /customSelectStyles\['select-dropdown'\]/)
  assert.match(source('../features/alias/ui/AliasPanel.tsx'), /uiStyles\['search-input'\]/)
  assert.match(source('../features/alias/ui/AliasPanel.tsx'), /uiStyles\.tooltip/)
  assert.match(source('../features/local-download/ui/LocalDownloadMappingPane.tsx'), /confirmDialogStyles\.modal/)
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
  assert.doesNotMatch(legacyStyles, /^\.data-row \.row-trailing > \.host-auth-badge\s*\{/m)
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

test('主机目录行、搜索、提示层与头像样式由 Host Module 承载', () => {
  const hostContextPanelSource = source('../features/hosts/ui/HostContextPanel.tsx')
  const hostContextPanelStyles = source('../features/hosts/ui/HostContextPanel.module.scss')
  const hostAvatarSource = source('../entities/host/ui/HostAvatar.tsx')
  const hostAvatarStyles = source('../entities/host/ui/HostAvatar.module.scss')
  const legacyStyles = source('../shared/main-styles/workstation.scss')

  assert.match(hostContextPanelSource, /styles\['host-context-search'\]/)
  assert.match(hostContextPanelSource, /classNames=\{\{ root: `\$\{styles\['host-row-tooltip'\]\}/)
  assert.match(hostContextPanelSource, /styles\['host-row-tooltip-card'\]/)
  assert.match(hostContextPanelStyles, /\.host-context-search:global\(\.ant-input-affix-wrapper\)\s*\{[^}]*margin:\s*12px 0 16px;/s)
  assert.match(hostContextPanelStyles, /\.host-context-search:global\(\.ant-input-affix-wrapper\)\s*\{[^}]*padding:\s*0 11px;[^}]*rgb\(255 255 255 \/ 4%\)/s)
  assert.match(hostContextPanelStyles, /\.host-context-search:global\(\.ant-input-affix-wrapper\)::after\s*\{[^}]*right:\s*12px;[^}]*transform:\s*scaleX\(0\.72\);/s)
  assert.match(hostContextPanelStyles, /\.host-stack\s*\{[^}]*gap:\s*6px;[^}]*padding:\s*0 2px 14px 0;/s)
  assert.match(hostContextPanelStyles, /\.host-row\s*\{[^}]*min-height:\s*42px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s)
  assert.match(hostContextPanelStyles, /\.host-row-tooltip :global\(\.ant-tooltip-inner\)/)
  assert.match(hostContextPanelStyles, /min-width:\s*260px;[^}]*max-width:\s*312px;[^}]*background:\s*#25272e;/s)

  assert.match(hostAvatarSource, /styles\['has-custom-icon'\]/)
  assert.match(hostAvatarStyles, /\.host-avatar\.host-avatar\s*\{[^}]*--host-avatar-size:\s*30px;[^}]*display:\s*inline-grid;/s)
  assert.match(hostAvatarStyles, /\.host-avatar\.has-custom-icon\s*\{/)

  for (const selector of [
    /^\.host-stack(?:\s|,|\{)/m,
    /^\.host-filter-(?:panel|primary-row|meta|clear|tags)(?:\s|\.|\{)/m,
    /^\.host-search-input(?:\s|\.|\{)/m,
    /^\.host-context-panel \.host-context-search(?:\s|\.|:|\{)/m,
    /^\.group-label(?:\s|\{)/m,
    /^\.host-row(?:\s|,|\.|:|\{)/m,
    /^\.host-row-tooltip(?:\s|-|\{)/m,
    /^\.host-avatar(?:\s|\.|\{)/m,
    /^\.data-(?:list|row)(?:\s|,|\.|:|\{)/m,
    /^\.row-(?:icon|copy|trailing)(?:\s|\{)/m,
    /^\.soft-tag(?:\s|\.|\{)/m,
    /^\.host-(?:data-list|tag-summary|row-meta-line|row-endpoint|row-tags|row-tag|tags-field)(?:\s|\.|\{)/m,
  ]) {
    assert.doesNotMatch(legacyStyles, selector)
  }
})
