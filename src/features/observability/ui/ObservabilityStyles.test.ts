import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileString } from 'sass'

const styleUrl = new URL('./Observability.module.scss', import.meta.url)
const source = readFileSync(fileURLToPath(styleUrl), 'utf8')

test('监控与进程 SCSS 保留面板及 Portal 的历史全局类名', () => {
  const compiled = compileString(source, { url: styleUrl }).css

  for (const className of [
    'system-monitor-panel',
    'process-panel',
    'process-filter-popover',
    'monitor-device-select-dropdown',
    'monitor-chart-tooltip',
  ]) {
    assert.match(compiled, new RegExp(`:global \\.${className}(?:[\\s.:,{])`))
  }
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
    /\.process-panel \.process-terminate-button\.ant-btn\s*\{[\s\S]*height:\s*34px/,
  )
})

test('跨模块 Select 与 Tooltip 规则继续由全局样式持有', () => {
  const workstation = readFileSync(
    fileURLToPath(new URL('../../../styles/workstation.css', import.meta.url)),
    'utf8',
  )

  assert.doesNotMatch(source, /^\.termous-(?:select-dropdown|tooltip)/m)
  assert.match(workstation, /^\.termous-select-dropdown\.ant-select-dropdown/m)
  assert.match(workstation, /^\.termous-tooltip\.ant-tooltip/m)
})
