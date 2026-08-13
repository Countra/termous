import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const source = readFileSync(
  fileURLToPath(new URL('./EChartView.module.scss', import.meta.url)),
  'utf8',
)

test('共享图表容器保留迁移前的最小高度和裁剪边界', () => {
  assert.match(source, /\.root\s*\{[\s\S]*min-height:\s*76px/)
  assert.match(source, /border-radius:\s*10px/)
  assert.match(source, /overflow:\s*hidden/)
})
