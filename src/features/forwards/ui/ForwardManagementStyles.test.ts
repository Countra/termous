import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileString } from 'sass'

const styleUrl = new URL('./ForwardManagement.module.scss', import.meta.url)
const source = readFileSync(fileURLToPath(styleUrl), 'utf8')

test('端口转发 SCSS 保留页面、会话和 Portal 的历史全局类名', () => {
  const compiled = compileString(source, { url: styleUrl }).css

  for (const className of [
    'forwarding-page',
    'forward-session-panel',
    'forwarding-modal',
    'forward-route-tooltip',
    'forward-runtime-metric-detail',
  ]) {
    assert.match(compiled, new RegExp(`:global \\.${className}(?:[\\s.:,{])`))
  }
})

test('端口转发关键交互尺寸和响应式边界保持不变', () => {
  assert.match(source, /grid-template-columns:\s*28px 1px 28px/)
  assert.match(source, /\.forward-runtime-action\.ant-btn\s*\{[\s\S]*width:\s*28px/)
  assert.match(source, /@container forward-session \(max-width:\s*339px\)/)
  assert.match(source, /@container forward-session \(max-width:\s*259px\)/)
  assert.match(source, /@container forwarding-page \(max-width:\s*660px\)/)
})
