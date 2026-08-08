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

const servicePanel = readStyle('../features/service/ui/ServicePanel.module.scss')
const serviceLogs = readStyle('../features/service/ui/ServiceLogsModal.module.scss')
const docker = readStyle('../features/docker/ui/DockerPanel.module.scss')
const firewall = readStyle('../features/firewall/ui/FirewallPanel.module.scss')
const detection = readStyle('../shared/ui/WorkspaceDetectionLoading.module.scss')
const workstation = readFileSync(
  fileURLToPath(new URL('../shared/main-styles/workstation.scss', import.meta.url)),
  'utf8',
)

test('远端管理 SCSS 保留面板与 Portal 的历史全局类名', () => {
  for (const [compiled, classNames] of [
    [servicePanel.compiled, ['service-panel', 'service-filter-popover']],
    [serviceLogs.compiled, ['service-logs-modal-root', 'service-logs-modal']],
    [docker.compiled, ['docker-panel', 'docker-filter-popover']],
    [firewall.compiled, ['firewall-panel', 'firewall-rule-modal', 'firewall-persistence-modal']],
  ] as const) {
    for (const className of classNames) {
      assert.match(compiled, new RegExp(`:global \\.${className}(?:[\\s.:,{])`))
    }
  }
})

test('共享检测加载状态由组件 Module 私有类承载', () => {
  assert.doesNotMatch(detection.source, /:global|stylelint-disable/)
  assert.match(detection.source, /\.root\s*{[^}]*min-height:\s*150px/)
  assert.match(detection.source, /\.card\s*{[^}]*padding:\s*18px/)
})

test('远端管理私有样式离开全局工作站文件且共享弹层规则保留', () => {
  assert.doesNotMatch(workstation, /^\.(?:service|docker|firewall)-/m)
  assert.doesNotMatch(workstation, /^\.workbench-detection-loading/m)
  assert.match(workstation, /^\.termous-select-dropdown\.ant-select-dropdown/m)
  assert.match(workstation, /^\.termous-tooltip\.ant-tooltip/m)
})

test('远端管理关键滚动与弹层尺寸保持不变', () => {
  assert.match(servicePanel.source, /\.service-list,\s*\.service-detail\s*{[^}]*overflow-y:\s*auto/)
  assert.match(serviceLogs.source, /\.service-logs-console\s*{[^}]*overflow:\s*auto/)
  assert.match(docker.source, /\.docker-log-section pre\s*{[^}]*max-height:\s*220px/)
  assert.match(firewall.source, /\.firewall-preview-modal \.ant-modal-body\s*{[^}]*overflow:\s*auto/)
  assert.match(detection.source, /\.root\s*{[^}]*min-height:\s*150px/)
})
