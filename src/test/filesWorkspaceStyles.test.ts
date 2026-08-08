import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const workspaceStyles = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/FilesWorkspace.module.scss', import.meta.url)),
  'utf8',
)
const workspaceSource = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/FilesWorkspace.tsx', import.meta.url)),
  'utf8',
)
const panelStyles = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/_FilesWorkspacePanels.module.scss', import.meta.url)),
  'utf8',
)
const surfaceStyles = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/_FilesWorkspaceSurface.module.scss', import.meta.url)),
  'utf8',
)
const detailsStyles = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/_FilesWorkspaceDetails.module.scss', import.meta.url)),
  'utf8',
)
const appSource = readFileSync(
  fileURLToPath(new URL('../app/main/App.tsx', import.meta.url)),
  'utf8',
)
const rendererSource = readFileSync(
  fileURLToPath(new URL('../app/renderer-entry/main.tsx', import.meta.url)),
  'utf8',
)
const sharedStylesSource = readFileSync(
  fileURLToPath(new URL('../shared/styles/index.ts', import.meta.url)),
  'utf8',
)
const transferDockStyles = readFileSync(
  fileURLToPath(new URL('../features/transfers/ui/TransferQueueDock.module.scss', import.meta.url)),
  'utf8',
)
const transferRowsStyles = readFileSync(
  fileURLToPath(new URL('../features/transfers/ui/TransferQueueRows.module.scss', import.meta.url)),
  'utf8',
)
const bookmarkRailStyles = readFileSync(
  fileURLToPath(new URL('../features/file-bookmarks/ui/FileBookmarksRail.module.scss', import.meta.url)),
  'utf8',
)
const bookmarkSidebarStyles = readFileSync(
  fileURLToPath(new URL('../features/file-bookmarks/ui/FileBookmarksSidebar.module.scss', import.meta.url)),
  'utf8',
)
const remoteFileModalStyles = readFileSync(
  fileURLToPath(new URL('../features/remote-file/ui/RemoteFileModalShared.module.scss', import.meta.url)),
  'utf8',
)

test('文件工作区局部动画与 CSS Modules 使用同一 keyframe 作用域', () => {
  assert.match(workspaceStyles, /@keyframes files-drop-mask-enter/)
  for (const animation of [
    'files-directory-progress',
    'files-skeleton',
    'files-status-pulse',
    'files-side-panel-enter',
  ]) {
    assert.match(panelStyles, new RegExp(`@keyframes ${animation}`))
  }
  assert.doesNotMatch(`${workspaceStyles}\n${panelStyles}`, /@keyframes :global\(files-/)
})

test('全局文件辅助选择器引用稳定的全局 keyframe 名称', () => {
  assert.match(transferDockStyles, /@keyframes :global\(transfer-queue-pulse\)/)
  assert.match(transferRowsStyles, /@keyframes :global\(termous-spin\)/)
  assert.match(transferRowsStyles, /@keyframes :global\(transfer-queue-slide\)/)
  assert.match(bookmarkRailStyles, /@keyframes :global\(termous-spin\)/)
  assert.match(bookmarkSidebarStyles, /@keyframes :global\(termous-spin\)/)
  assert.match(remoteFileModalStyles, /@keyframes :global\(termous-spin\)/)
  assert.match(remoteFileModalStyles, /@keyframes :global\(file-operation-indeterminate\)/)
})

test('文件工作区样式使用局部模块边界', () => {
  for (const source of [workspaceStyles, panelStyles, surfaceStyles, detailsStyles]) {
    assert.doesNotMatch(source, /:global\s*\{/)
    assert.doesNotMatch(source, /stylelint-disable[^\n]*termous\/no-unscoped-global/)
  }

  for (const className of [
    'files-workspace-page',
    'files-table',
    'files-detail-panel',
    'files-status-bar',
    'files-row-menu',
  ]) {
    assert.match(workspaceSource, new RegExp(`styles\\['${className}'\\]`))
  }

  for (const pattern of [
    /\.files-chrome-button:global\(\.ant-btn\)/,
    /\.files-table :global\(\.ant-table\)/,
    /\.files-workspace-breadcrumb:global\(\.ant-breadcrumb\)/,
    /\.files-row-menu :global\(\.ant-dropdown-menu\)/,
  ]) {
    assert.match(`${workspaceStyles}\n${surfaceStyles}\n${detailsStyles}`, pattern)
  }
})

test('文件工作区样式由共享入口和组件 Module 加载', () => {
  const sharedStyleImport = rendererSource.indexOf("import '#shared/styles'")
  const mainSurfaceImport = rendererSource.indexOf("main: () => import('#app/main')")
  const globalStyleImport = sharedStylesSource.indexOf("import './global.scss'")
  const filesPageImport = appSource.indexOf("from '#pages/files'")
  const filesWorkspaceImport = appSource.indexOf("from '#widgets/files-workspace'")

  assert.ok(sharedStyleImport >= 0)
  assert.ok(mainSurfaceImport > sharedStyleImport)
  assert.ok(globalStyleImport >= 0)
  assert.doesNotMatch(appSource, /#shared\/main-styles/)
  assert.ok(filesPageImport >= 0)
  assert.ok(filesWorkspaceImport >= 0)
})

test('文件工作区行为使用稳定数据标记而不读取内部样式类名', () => {
  for (const marker of [
    'data-files-drag-block',
    'data-file-kind-icon',
    'data-files-entry-open',
    'data-files-name-cell',
    'data-files-row-menu',
    'data-files-table-row',
    'data-files-entry-kind',
  ]) {
    assert.match(workspaceSource, new RegExp(marker))
  }
  assert.doesNotMatch(
    workspaceSource,
    /(?:closest|querySelector)(?:<[^>]+>)?\('\.(?:files-icon-button|files-table-column-resizer|file-kind-icon|file-name-copy|files-table-name-cell)'/,
  )
  assert.doesNotMatch(workspaceSource, /closest<HTMLElement>\('\.files-table-row\.is-directory/)
  assert.doesNotMatch(workspaceSource, /target\.closest\('\.ant-dropdown'\)/)
  assert.doesNotMatch(workspaceSource, /classList\.(?:add|remove)\('is-files-column-resizing'\)/)
})
