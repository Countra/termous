import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const workbenchSource = readFileSync(
  fileURLToPath(new URL('../features/workbench/WorkbenchPage.tsx', import.meta.url)),
  'utf8',
)

test('工作台隐藏时停止系统监控与进程刷新', () => {
  assert.match(
    workbenchSource,
    /enabled=\{active && detailsActiveTab === 'monitor' && !detailsCollapsed\}/,
  )
  assert.match(
    workbenchSource,
    /enabled=\{active && detailsActiveTab === 'processes' && !detailsCollapsed\}/,
  )
})
