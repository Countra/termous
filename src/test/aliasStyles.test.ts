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

test('Alias SCSS 保留面板与 Portal 的历史全局类名', () => {
  for (const [compiled, classNames] of [
    [panel.compiled, ['alias-panel', 'alias-delete-popconfirm', 'alias-detail-tooltip']],
    [syncModal.compiled, ['alias-sync-modal-root', 'alias-sync-modal']],
  ] as const) {
    for (const className of classNames) {
      assert.match(compiled, new RegExp(`:global \\.${className}(?:[\\s.:,{])`))
    }
  }
})

test('Alias 关键滚动、弹层与紧凑列表尺寸保持不变', () => {
  assert.match(panel.source, /\.alias-panel-list\s*\{[^}]*overflow-y:\s*auto/s)
  assert.match(
    syncModal.source,
    /\.alias-sync-modal \.ant-modal-container\s*\{[^}]*background:\s*var\(--surface-strong\);[^}]*padding:\s*0;/s,
  )
  assert.match(
    syncModal.source,
    /\.alias-sync-select-row\.ant-checkbox-wrapper\s*\{[^}]*height:\s*52px;[^}]*padding:\s*6px 8px;/s,
  )
  assert.match(syncModal.source, /\.alias-sync-target-list\s*\{[^}]*overflow:\s*auto/s)
  assert.match(syncModal.source, /animation:\s*alias-sync-spin 0\.85s linear infinite/)
  assert.match(syncModal.source, /@keyframes\s+:global\(alias-sync-spin\)/)
})
