import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const styleUrl = new URL('./Observability.module.scss', import.meta.url)
const source = readFileSync(fileURLToPath(styleUrl), 'utf8')
const processSource = readFileSync(
  fileURLToPath(new URL('./ProcessPanel.tsx', import.meta.url)),
  'utf8',
)
const monitorSource = readFileSync(
  fileURLToPath(new URL('./SystemMonitorPanel.tsx', import.meta.url)),
  'utf8',
)

test('监控与进程面板使用私有 Module 类并局部约束 Portal', () => {
  assert.doesNotMatch(source, /stylelint-disable[^\n]*termous\/no-unscoped-global/)
  assert.doesNotMatch(source, /:global\s*\{/)
  assert.match(source, /\.process-filter-popover:global\(\.ant-popover\)/)
  assert.match(source, /\.monitor-device-select-dropdown :global\(\.ant-select-item-option-content\)/)
  assert.match(source, /\.monitor-time-chart:global\(\.echart-view\)/)
  assert.match(processSource, /overlayClassName=\{styles\['process-filter-popover'\]\}/)
  assert.match(processSource, /styles\['process-state-tooltip-root'\]/)
  assert.match(monitorSource, /styles\['monitor-device-select-dropdown'\]/)
  assert.match(monitorSource, /className: styles\['monitor-chart-tooltip'\]/)
})

test('监控关键滚动尺寸和 CPU 响应式边界保持不变', () => {
  assert.match(source, /--monitor-cpu-view-height:\s*168px/)
  assert.match(source, /@container monitor-cpu-panel \(max-width:\s*250px\)/)
  assert.match(source, /\.monitor-cpu-core-list\s*\{[\s\S]*overflow-y:\s*auto/)
  assert.match(source, /\.monitor-disk-list\s*\{[\s\S]*max-height:\s*330px/)
})

test('进程终止按钮保留尺寸，并抵御后加载的通用按钮规则', () => {
  assert.match(
    source,
    /\.process-panel \.process-terminate-button:global\(\.ant-btn\)\s*\{[\s\S]*height:\s*34px/,
  )
})

test('跨模块 Select 与 Tooltip 规则由共享 Module 持有', () => {
  const selectStyles = readFileSync(
    fileURLToPath(new URL('../../../shared/ui/CustomSelect.module.scss', import.meta.url)),
    'utf8',
  )
  const primitiveStyles = readFileSync(
    fileURLToPath(new URL('../../../shared/ui/Primitives.module.scss', import.meta.url)),
    'utf8',
  )

  assert.doesNotMatch(source, /^\.termous-(?:select-dropdown|tooltip)/m)
  assert.match(selectStyles, /^\.select-dropdown:global\(\.ant-select-dropdown\)/m)
  assert.match(primitiveStyles, /^\.tooltip:global\(\.ant-tooltip\)/m)
  assert.match(monitorSource, /customSelectStyles\['select-dropdown'\]/)
  assert.match(monitorSource, /uiStyles\.tooltip/)
})
