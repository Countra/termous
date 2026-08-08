import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileString } from 'sass'

function readStyle(relativePath: string) {
  const url = new URL(relativePath, import.meta.url)
  const source = readFileSync(fileURLToPath(url), 'utf8')
  return { compiled: compileString(source, { url }).css, source }
}

const panel = readStyle('../features/alias/ui/AliasPanel.module.scss')
const syncModal = readStyle('../features/alias/ui/AliasSyncModal.module.scss')
const syncModalSource = readFileSync(
  fileURLToPath(new URL('../features/alias/ui/AliasSyncModal.tsx', import.meta.url)),
  'utf8',
)
const panelView = readFileSync(
  fileURLToPath(new URL('../features/alias/ui/AliasPanel.tsx', import.meta.url)),
  'utf8',
)
const panelParts = readFileSync(
  fileURLToPath(new URL('../features/alias/ui/AliasPanelParts.tsx', import.meta.url)),
  'utf8',
)
const editorView = readFileSync(
  fileURLToPath(new URL('../features/alias/ui/AliasEditorView.tsx', import.meta.url)),
  'utf8',
)

test('Alias 面板使用私有 Module 类并只局部开放 Portal 第三方节点', () => {
  assert.doesNotMatch(panel.source, /stylelint-disable[^\n]*termous\/no-unscoped-global/)
  assert.doesNotMatch(panel.source, /:global\s*\{/)
  assert.match(panel.source, /\.alias-delete-popconfirm:global\(\.ant-popover\)/)
  assert.match(panel.source, /\.alias-detail-tooltip :global\(\.ant-tooltip-inner\)/)
  assert.match(panelView, /styles\['alias-panel'\]/)
  assert.match(panelParts, /rootClassName=\{styles\['alias-delete-popconfirm'\]\}/)
  assert.match(panelParts, /styles\['alias-detail-tooltip'\]/)
  assert.match(editorView, /styles\['alias-editor-page'\]/)
})

test('Alias 同步弹窗通过 Module 类约束内部样式与 Portal', () => {
  assert.doesNotMatch(syncModal.source, /:global\s*\{/)
  assert.doesNotMatch(syncModal.source, /termous\/no-unscoped-global/)
  assert.match(syncModalSource, /className=\{styles\.modal\}/)
  assert.match(syncModalSource, /styles\['select-row'\]/)
  assert.match(syncModalSource, /styles\['host-tooltip'\]/)
})

test('Alias 关键滚动、弹层与紧凑列表尺寸保持不变', () => {
  assert.match(panel.source, /\.alias-panel-list\s*\{[^}]*overflow-y:\s*auto/s)
  assert.match(
    syncModal.source,
    /\.modal\s+:global\(\.ant-modal-container\)\s*\{[^}]*background:\s*var\(--surface-strong\);[^}]*padding:\s*0;/s,
  )
  assert.match(
    syncModal.source,
    /\.select-row:global\(\.ant-checkbox-wrapper\)\s*\{[^}]*height:\s*52px;[^}]*padding:\s*6px 8px;/s,
  )
  assert.match(syncModal.source, /\.target-list\s*\{[^}]*overflow:\s*auto/s)
  assert.match(syncModal.source, /animation:\s*alias-sync-spin 0\.85s linear infinite/)
  assert.match(syncModal.source, /@keyframes\s+alias-sync-spin/)
})
