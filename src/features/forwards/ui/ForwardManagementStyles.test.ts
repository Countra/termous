import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileString } from 'sass'

const styleUrl = new URL('./ForwardManagement.module.scss', import.meta.url)
const source = readFileSync(fileURLToPath(styleUrl), 'utf8')

test('端口转发 SCSS 保留页面、会话和 Portal 的模块样式', () => {
  const compiled = compileString(source, { url: styleUrl }).css

  for (const className of [
    'forwarding-page',
    'forward-session-panel',
    'forwarding-modal',
    'forward-route-tooltip',
    'forward-runtime-metric-detail',
  ]) {
    assert.match(compiled, new RegExp(`\\.${className}(?:[\\s.:,{])`))
  }

  assert.doesNotMatch(source, /termous\/no-unscoped-global/)
  assert.doesNotMatch(source, /^\s*:global\s*\{/m)
  assert.match(source, /\.forward-runtime-action:global\(\.ant-btn\)/)
  assert.match(source, /\.forwarding-modal :global\(\.ant-modal-content\)/)
  assert.match(
    source,
    /\.forwarding-modal-profile-editor :global\(\.ant-modal-close\)\s*\{[\s\S]*?top:\s*19px/,
  )
})

test('端口转发消费者挂载同一模块实现和独立 Portal 根', () => {
  for (const fileName of [
    'ForwardEditorFields.tsx',
    'ForwardManagementWorkspace.tsx',
    'ForwardModeSelector.tsx',
    'ForwardRouteDiagram.tsx',
    'ForwardRuntimeActions.tsx',
    'ForwardRuntimeMetrics.tsx',
    'ForwardSessionPanel.tsx',
    'ForwardStateFeedback.tsx',
  ]) {
    const consumer = readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), 'utf8')
    assert.match(consumer, /import styles from '\.\/ForwardManagement\.module\.scss'/)
    assert.match(consumer, /const scopedClassName =/)
  }

  const workspace = readFileSync(
    fileURLToPath(new URL('./ForwardManagementWorkspace.tsx', import.meta.url)),
    'utf8',
  )
  const customSelect = readFileSync(
    fileURLToPath(new URL('../../../shared/ui/CustomSelect.tsx', import.meta.url)),
    'utf8',
  )

  assert.match(workspace, /rootClassName=\{scopedClassName\('forwarding-modal-root'\)\}/)
  assert.match(workspace, /editorMode === 'profile' \? 'forwarding-modal-profile-editor' : ''/)
  assert.match(workspace, /rootClassName=\{scopedClassName\('forwarding-delete-popconfirm'\)\}/)
  assert.match(workspace, /popupClassName=\{scopedClassName\('forwarding-select-popup'\)\}/)
  assert.match(customSelect, /popupClassName\?: string/)
})

test('端口转发关键交互尺寸和响应式边界保持不变', () => {
  assert.match(source, /grid-template-columns:\s*28px 1px 28px/)
  assert.match(source, /\.forward-runtime-action:global\(\.ant-btn\)\s*\{[\s\S]*width:\s*28px/)
  assert.match(source, /@container forward-session \(max-width:\s*339px\)/)
  assert.match(source, /@container forward-session \(max-width:\s*259px\)/)
  assert.match(source, /@container forwarding-page \(max-width:\s*660px\)/)
})
