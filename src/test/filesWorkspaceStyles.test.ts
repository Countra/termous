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
const workstationStyles = readFileSync(
  fileURLToPath(new URL('../shared/main-styles/workstation.scss', import.meta.url)),
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
const mainStylesSource = readFileSync(
  fileURLToPath(new URL('../shared/main-styles/index.ts', import.meta.url)),
  'utf8',
)

test('文件工作区动画使用稳定的全局 keyframe 名称', () => {
  assert.match(workspaceStyles, /@keyframes :global\(files-drop-mask-enter\)/)
  for (const animation of [
    'files-directory-progress',
    'files-skeleton',
    'files-status-pulse',
    'files-side-panel-enter',
  ]) {
    assert.match(panelStyles, new RegExp(`@keyframes :global\\(${animation}\\)`))
  }
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

test('共享工作台样式不再承载文件工作区选择器', () => {
  for (const className of [
    'files-page',
    'files-row-menu',
    'files-icon-button',
    'file-name-tooltip',
  ]) {
    assert.doesNotMatch(workstationStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }
})

test('文件工作区样式在旧工作台样式后加载', () => {
  const sharedStyleImport = rendererSource.indexOf("import '#shared/styles'")
  const mainSurfaceImport = rendererSource.indexOf("main: () => import('#app/main')")
  const mainStyleImport = appSource.indexOf("import '#shared/main-styles'")
  const globalStyleImport = sharedStylesSource.indexOf("import './global.scss'")
  const workstationStyleImport = mainStylesSource.indexOf("import './workstation.scss'")
  const filesPageImport = appSource.indexOf("from '#pages/files'")
  const filesWorkspaceImport = appSource.indexOf("from '#widgets/files-workspace'")

  assert.ok(sharedStyleImport >= 0)
  assert.ok(mainSurfaceImport > sharedStyleImport)
  assert.ok(mainStyleImport >= 0)
  assert.ok(globalStyleImport >= 0)
  assert.ok(workstationStyleImport >= 0)
  assert.doesNotMatch(mainStylesSource, /app\.scss/)
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
