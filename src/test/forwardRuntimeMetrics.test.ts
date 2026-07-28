import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('高频端口转发指标使用无 React 状态的顶层详情浮层', () => {
  const source = readFileSync(
    join(sourceRoot, 'features', 'forwards', 'ForwardRuntimeMetrics.tsx'),
    'utf8',
  )
  const styles = readFileSync(
    join(sourceRoot, 'features', 'forwards', 'forwarding.css'),
    'utf8',
  )

  assert.doesNotMatch(source, /\bTooltip\b/)
  assert.doesNotMatch(source, /<output\b/)
  assert.doesNotMatch(source, /role="tooltip"/)
  assert.match(source, /aria-label=/)
  assert.match(source, /aria-hidden="true"/)
  assert.match(source, /tabIndex=\{rate \? 0/)
  assert.match(source, /popover="manual"/)
  assert.match(source, /forward-runtime-rate/)
  assert.match(source, /forward-runtime-metric-detail/)
  assert.match(styles, /background:\s*var\(--app-bg-elevated\)/)
  assert.doesNotMatch(styles, /backdrop-filter/)
  assert.match(styles, /position:\s*fixed/)
  assert.match(styles, /inset:\s*auto/)
})

test('隐藏的工作台转发面板会停用实时速度采样', () => {
  const workbench = readFileSync(
    join(sourceRoot, 'features', 'workbench', 'WorkbenchPage.tsx'),
    'utf8',
  )
  const sessionPanel = readFileSync(
    join(sourceRoot, 'features', 'forwards', 'ForwardSessionPanel.tsx'),
    'utf8',
  )
  const hook = readFileSync(
    join(sourceRoot, 'features', 'forwards', 'useForwardThroughput.ts'),
    'utf8',
  )

  assert.match(workbench, /enabled=\{active && detailsActiveTab === 'forwards' && !detailsCollapsed\}/)
  assert.match(sessionPanel, /<ForwardRuntimeMetrics compact enabled=\{enabled\}/)
  assert.match(hook, /if \(!enabled\) \{\s*return\s*\}/)
})
