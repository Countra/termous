import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileString } from 'sass'
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

test('文件工作区历史行为类保持全局选择器', () => {
  const compiledPanels = compileString(
    "@use 'FilesWorkspacePanels.module' as panels; @include panels.styles;",
    {
      loadPaths: [
        fileURLToPath(new URL('../widgets/files-workspace/ui', import.meta.url)),
      ],
    },
  ).css

  for (const className of [
    'files-bookmarks-sidebar',
    'files-transfer-scope',
    'files-status-bar',
  ]) {
    assert.match(compiledPanels, new RegExp(`:global \\.${className}(?:[\\s.:,{])`))
  }
})

test('文件工作区样式在旧工作台样式后加载', () => {
  const sharedStyleImport = rendererSource.indexOf("import '#shared/styles'")
  const mainSurfaceImport = rendererSource.indexOf("main: () => import('#app/main')")
  const mainStyleImport = appSource.indexOf("import '#shared/main-styles'")
  const globalStyleImport = sharedStylesSource.indexOf("import './global.scss'")
  const appStyleImport = mainStylesSource.indexOf("import '../styles/app.scss'")
  const workstationStyleImport = mainStylesSource.indexOf("import '../styles/workstation.scss'")
  const filesPageImport = appSource.indexOf("from '#pages/files'")
  const filesWorkspaceImport = appSource.indexOf("from '#widgets/files-workspace'")

  assert.ok(sharedStyleImport >= 0)
  assert.ok(mainSurfaceImport > sharedStyleImport)
  assert.ok(mainStyleImport >= 0)
  assert.ok(globalStyleImport >= 0)
  assert.ok(appStyleImport >= 0)
  assert.ok(workstationStyleImport >= 0)
  assert.ok(workstationStyleImport > appStyleImport)
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
