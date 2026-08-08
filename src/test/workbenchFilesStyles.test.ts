import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function readStyle(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const panelStyles = readStyle('../features/workbench-files/ui/WorkbenchFilesPanel.module.scss')
const controlsStyles = readStyle('../features/workbench-files/ui/WorkbenchFileControls.module.scss')
const browserStyles = readStyle('../features/workbench-files/ui/WorkbenchFileList.module.scss')
const bookmarksStyles = readStyle('../features/workbench-files/ui/WorkbenchBookmarksPopover.module.scss')
const transferStyles = readStyle('../features/workbench-files/ui/WorkbenchTransferBar.module.scss')
const featureSidePanelStyles = readStyle('../shared/ui/FeatureSidePanel.module.scss')
const panelSource = readStyle('../features/workbench-files/ui/WorkbenchFilesPanel.tsx')
const listSource = readStyle('../features/workbench-files/ui/WorkbenchFileList.tsx')
const transferSource = readStyle('../features/workbench-files/ui/WorkbenchTransferBar.tsx')
const bookmarksSource = readStyle('../features/workbench-files/ui/WorkbenchBookmarksPopover.tsx')
const bookmarkEditorSource = readStyle('../features/workbench-files/ui/WorkbenchBookmarkEditorModal.tsx')

test('工作台文件面板保留固定布局、滚动边界和传输条避让', () => {
  assert.match(
    panelStyles,
    /\.workbench-files-panel\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\);[^}]*overflow:\s*hidden;/s,
  )
  assert.match(
    panelStyles,
    /\.workbench-files-panel:has\(\[data-workbench-file-transfer\]\[data-state='active'\]\)\s*\{[^}]*--workbench-file-transfer-clearance:\s*96px;/s,
  )
  assert.match(
    featureSidePanelStyles,
    /\.details-tabs\s+:global\(\.ant-tabs-content-active\):has\(> \[data-workbench-files-panel\]\)\s*\{[^}]*overflow:\s*hidden;[^}]*padding-right:\s*0;/s,
  )
  assert.doesNotMatch(panelStyles, /\.details-tabs/)
  assert.match(
    browserStyles,
    /\.workbench-file-list-shell\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s,
  )
  assert.match(
    browserStyles,
    /\.workbench-file-list\s*\{[^}]*overflow:\s*auto;/s,
  )
  assert.match(
    panelStyles,
    /\.workbench-files-breadcrumb-viewport\s*\{[^}]*overflow:\s*auto hidden;/s,
  )
  assert.match(
    browserStyles,
    /\.workbench-files-panel:has\(\[data-workbench-file-transfer\]\)\s+\.workbench-file-list/,
  )
  assert.match(
    transferStyles,
    /\.workbench-file-transfer\s*\{[^}]*min-height:\s*50px;/s,
  )
})

test('工作台文件控件保留紧凑尺寸与 Popover 滚动上限', () => {
  assert.match(
    controlsStyles,
    /\.workbench-files-upload-button:global\(\.ant-btn\)\s*\{[^}]*height:\s*32px;/s,
  )
  assert.match(
    bookmarksStyles,
    /\.workbench-bookmarks-list\s*\{[^}]*overflow:\s*hidden auto;/s,
  )
  assert.match(
    bookmarksStyles,
    /\.workbench-bookmarks-trigger:global\(\.ant-btn\)\s*\{[^}]*display:\s*inline-grid;[^}]*border:\s*1px solid transparent;/s,
  )
})

test('工作台文件动画名称和降级规则保持稳定', () => {
  for (const [styles, keyframes] of [
    [panelStyles, ['workbench-files-spin', 'workbench-files-loading-track']],
    [controlsStyles, ['workbench-files-follow-spin', 'workbench-files-follow-halo']],
    [browserStyles, [
      'workbench-files-spin',
      'workbench-file-list-enter',
      'workbench-file-tooltip-in',
      'workbench-files-skeleton',
      'workbench-files-drop-in',
    ]],
    [bookmarksStyles, ['workbench-bookmarks-spin']],
  ] as const) {
    for (const keyframe of keyframes) {
      assert.match(styles, new RegExp(`@keyframes\\s+${keyframe}\\s*\\{`))
    }
  }

  for (const styles of [panelStyles, controlsStyles, browserStyles, transferStyles, bookmarksStyles]) {
    assert.doesNotMatch(styles, /termous\/no-unscoped-global/)
    assert.doesNotMatch(styles, /^:global\s*\{/m)
    assert.doesNotMatch(styles, /@keyframes\s+:global/)
  }

  assert.match(panelStyles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(bookmarksStyles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
})

test('工作台文件运行时查询不依赖样式类名', () => {
  assert.match(panelSource, /data-workbench-files-panel/)
  assert.match(transferSource, /data-workbench-file-transfer/)
  assert.match(transferSource, /data-state=\{active \? 'active' : 'failed'\}/)
  assert.match(panelSource, /data-phase=\{files\.recoveryState\.phase\}/)
  assert.match(listSource, /closest\('\[data-workbench-files-panel\]'\)/)
  assert.match(listSource, /querySelector\('\[data-workbench-file-transfer\]'\)/)
  assert.doesNotMatch(listSource, /closest\('\.workbench-files-panel'\)/)
  assert.doesNotMatch(listSource, /querySelector\('\.workbench-file-transfer'\)/)
})

test('工作台文件样式保持原级联顺序且不覆盖面板定位', () => {
  const panelImport = "import styles from './WorkbenchFilesPanel.module.scss'"
  const controlsImport = "import controlsStyles from './WorkbenchFileControls.module.scss'"

  assert.ok(panelSource.indexOf(panelImport) < panelSource.indexOf(controlsImport))
  assert.ok(panelSource.includes("className={`${panelClassName('workbench-files-toolbar')} ${controlsStyles.root}`}"))
  assert.doesNotMatch(
    panelSource,
    /'workbench-files-panel',[\s\S]{0,120}controlsStyles\.root/,
  )
})

test('工作台文件组件保留 legacy 类名并同时消费 Module 类', () => {
  assert.ok(
    listSource.includes('const scopedClassName = (className: string) => `${className} ${styles[className]}`'),
  )
  assert.ok(
    transferSource.includes('const scopedClassName = (className: string) => `${className} ${styles[className]}`'),
  )
  assert.ok(
    panelSource.includes("const panelClassName = (className: string) => [className, styles[className]].filter(Boolean).join(' ')"),
  )
  assert.ok(
    panelSource.includes("const controlsClassName = (className: string) => [panelClassName(className), controlsStyles[className]].filter(Boolean).join(' ')"),
  )
  assert.ok(panelSource.includes("panelClassName('workbench-files-panel')"))
  assert.ok(panelSource.includes("panelClassName('workbench-files-summary')"))
  assert.ok(panelSource.includes("panelClassName('workbench-file-transfer-overlay')"))
  assert.ok(panelSource.includes("fileListStyles['workbench-files-panel']"))
  assert.ok(panelSource.includes("controlsClassName('workbench-files-toolbar-row')"))
  assert.ok(listSource.includes("scopedClassName('workbench-file-list')"))
  assert.ok(transferSource.includes("scopedClassName('workbench-file-transfer')"))
})

test('书签浮层和编辑弹窗通过本地 Module root 约束 Portal 样式', () => {
  for (const source of [bookmarksSource, bookmarkEditorSource]) {
    assert.ok(
      source.includes('const scopedClassName = (...classNames: string[]) => classNames'),
    )
  }

  assert.ok(bookmarksSource.includes("classNames={{ root: scopedClassName('workbench-bookmarks-popover') }}"))
  assert.ok(bookmarksSource.includes("scopedClassName('termous-tooltip', 'workbench-bookmarks-tooltip')"))
  assert.ok(bookmarksSource.includes("scopedClassName('workbench-files-address-action', 'workbench-bookmarks-trigger')"))
  assert.ok(bookmarkEditorSource.includes("rootClassName={scopedClassName('termous-modal-root', 'workbench-bookmark-editor-root')}"))
  assert.ok(bookmarkEditorSource.includes("className={scopedClassName('workbench-bookmark-editor-modal')}"))
  assert.ok(bookmarkEditorSource.includes("root: scopedClassName('workbench-bookmark-editor-select-popup')"))

  assert.match(bookmarksStyles, /\.workbench-bookmarks-popover:global\(\.ant-popover\)/)
  assert.match(bookmarksStyles, /\.workbench-bookmark-editor-modal\s+:global\(\.ant-modal-content\)/)
  assert.match(bookmarksStyles, /\.workbench-bookmark-editor-select-popup:global\(\.ant-select-dropdown\)/)
})
