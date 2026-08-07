import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileString } from 'sass'
import test from 'node:test'

const workspaceStyles = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/FilesWorkspace.module.scss', import.meta.url)),
  'utf8',
)
const panelStyles = readFileSync(
  fileURLToPath(new URL('../widgets/files-workspace/ui/_FilesWorkspacePanels.module.scss', import.meta.url)),
  'utf8',
)
const appSource = readFileSync(
  fileURLToPath(new URL('../App.tsx', import.meta.url)),
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
  const workstationStyleImport = appSource.indexOf("import './styles/workstation.css'")
  const filesPageImport = appSource.indexOf("from '#pages/files'")
  const filesWorkspaceImport = appSource.indexOf("from '#widgets/files-workspace'")

  assert.ok(workstationStyleImport >= 0)
  assert.ok(filesPageImport > workstationStyleImport)
  assert.ok(filesWorkspaceImport > workstationStyleImport)
})
