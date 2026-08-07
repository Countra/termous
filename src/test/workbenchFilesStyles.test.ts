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
const panelSource = readStyle('../features/workbench-files/ui/WorkbenchFilesPanel.tsx')
const listSource = readStyle('../features/workbench-files/ui/WorkbenchFileList.tsx')
const transferSource = readStyle('../features/workbench-files/ui/WorkbenchTransferBar.tsx')

test('工作台文件面板保留固定布局、滚动边界和传输条避让', () => {
  assert.match(
    panelStyles,
    /\.workbench-files-panel\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\);[^}]*overflow:\s*hidden;/s,
  )
  assert.match(
    panelStyles,
    /\.workbench-files-panel:has\(\.workbench-file-transfer\.is-active\)\s*\{[^}]*--workbench-file-transfer-clearance:\s*96px;/s,
  )
  assert.match(
    browserStyles,
    /\.workbench-file-list-shell\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s,
  )
  assert.match(
    browserStyles,
    /\.workbench-file-list\s*\{[^}]*overflow:\s*auto;/s,
  )
  assert.match(
    transferStyles,
    /\.workbench-file-transfer\s*\{[^}]*min-height:\s*50px;/s,
  )
})

test('工作台文件控件保留紧凑尺寸与 Popover 滚动上限', () => {
  assert.match(
    controlsStyles,
    /\.workbench-files-upload-button\.ant-btn\s*\{[^}]*height:\s*32px;/s,
  )
  assert.match(
    bookmarksStyles,
    /\.workbench-bookmarks-list\s*\{[^}]*overflow-y:\s*auto;/s,
  )
})

test('工作台文件动画名称和降级规则保持稳定', () => {
  for (const [styles, keyframes] of [
    [panelStyles, ['workbench-files-spin', 'workbench-files-loading-track']],
    [controlsStyles, ['workbench-files-follow-spin', 'workbench-files-follow-halo']],
    [browserStyles, [
      'workbench-file-list-enter',
      'workbench-file-tooltip-in',
      'workbench-files-skeleton',
      'workbench-files-drop-in',
    ]],
    [bookmarksStyles, ['workbench-bookmarks-spin']],
  ] as const) {
    for (const keyframe of keyframes) {
      assert.match(styles, new RegExp(`@keyframes\\s+:global\\(${keyframe}\\)`))
    }
  }
  assert.match(panelStyles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(bookmarksStyles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
})

test('工作台文件运行时查询不依赖样式类名', () => {
  assert.match(panelSource, /data-workbench-files-panel/)
  assert.match(transferSource, /data-workbench-file-transfer/)
  assert.match(listSource, /closest\('\[data-workbench-files-panel\]'\)/)
  assert.match(listSource, /querySelector\('\[data-workbench-file-transfer\]'\)/)
  assert.doesNotMatch(listSource, /closest\('\.workbench-files-panel'\)/)
  assert.doesNotMatch(listSource, /querySelector\('\.workbench-file-transfer'\)/)
})

test('工作台文件样式保持原级联顺序且不覆盖面板定位', () => {
  const panelImport = "import styles from './WorkbenchFilesPanel.module.scss'"
  const controlsImport = "import controlsStyles from './WorkbenchFileControls.module.scss'"

  assert.ok(panelSource.indexOf(panelImport) < panelSource.indexOf(controlsImport))
  assert.match(
    panelSource,
    /className=\{`workbench-files-toolbar \$\{controlsStyles\.root\}`\}/,
  )
  assert.doesNotMatch(
    panelSource,
    /'workbench-files-panel',[\s\S]{0,120}controlsStyles\.root/,
  )
})
