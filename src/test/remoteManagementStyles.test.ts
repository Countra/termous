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
const servicePanelSource = readFileSync(
  fileURLToPath(new URL('../features/service/ui/ServicePanel.tsx', import.meta.url)),
  'utf8',
)
const serviceLogs = readStyle('../features/service/ui/ServiceLogsModal.module.scss')
const serviceLogsSource = readFileSync(
  fileURLToPath(new URL('../features/service/ui/ServiceLogsModal.tsx', import.meta.url)),
  'utf8',
)
const docker = readStyle('../features/docker/ui/DockerPanel.module.scss')
const dockerSource = readFileSync(
  fileURLToPath(new URL('../features/docker/ui/DockerPanel.tsx', import.meta.url)),
  'utf8',
)
const firewall = readStyle('../features/firewall/ui/FirewallPanel.module.scss')
const firewallPanelSource = readFileSync(
  fileURLToPath(new URL('../features/firewall/ui/FirewallPanel.tsx', import.meta.url)),
  'utf8',
)
const firewallPersistenceSource = readFileSync(
  fileURLToPath(new URL('../features/firewall/ui/FirewallPersistencePanel.tsx', import.meta.url)),
  'utf8',
)
const firewallRuleModalSource = readFileSync(
  fileURLToPath(new URL('../features/firewall/ui/FirewallRuleModal.tsx', import.meta.url)),
  'utf8',
)
const detection = readStyle('../shared/ui/WorkspaceDetectionLoading.module.scss')

test('防火墙面板使用私有 Module 类并局部约束 Modal Portal', () => {
  assert.doesNotMatch(firewall.source, /stylelint-disable[^\n]*termous\/no-unscoped-global/)
  assert.doesNotMatch(firewall.source, /:global\s*\{/)
  assert.match(
    firewall.source,
    /\.firewall-persistence-modal-root \.firewall-persistence-modal:global\(\.ant-modal\) :global\(\.ant-modal-body\)/,
  )
  assert.match(
    firewall.source,
    /\.firewall-rule-modal-root \.firewall-rule-modal:global\(\.ant-modal\) :global\(\.ant-modal-body\)/,
  )
  assert.match(firewallPanelSource, /styles\['firewall-panel'\]/)
  assert.match(firewallPanelSource, /styles\[firewallProviderStatusClass\(provider\)\]/)
  assert.match(firewallPersistenceSource, /rootClassName=\{styles\['firewall-persistence-modal-root'\]\}/)
  assert.match(firewallRuleModalSource, /rootClassName=\{styles\['firewall-rule-modal-root'\]\}/)
  assert.match(
    firewall.source,
    /\.firewall-rule-modal :global\(\.ant-modal-close\)\s*\{[\s\S]*?top:\s*20px/,
  )
})

test('防火墙规则显式按编辑索引区分模式，复制规则保持新建语义', () => {
  assert.match(firewallPanelSource, /mode=\{editing\.index === null \? 'create' : 'edit'\}/)
  assert.match(
    firewallPanelSource,
    /setEditing\(\{ index: null, value: \{ \.\.\.rule, id: undefined, raw_ref: undefined,/,
  )
})

test('服务面板使用私有 Module 类并局部约束 Portal 第三方节点', () => {
  assert.doesNotMatch(servicePanel.source, /stylelint-disable[^\n]*termous\/no-unscoped-global/)
  assert.doesNotMatch(servicePanel.source, /:global\s*\{/)
  assert.doesNotMatch(servicePanel.source, /\.service-filter-popover:global\(\.ant-popover\)/)
  assert.match(servicePanel.source, /\.service-operation-notification:global\(\.ant-notification-notice\)/)
  assert.match(servicePanelSource, /styles\['service-panel'\]/)
  assert.match(servicePanelSource, /<FilterPopover/)
  assert.match(servicePanelSource, /classNames=\{filterSelectClassNames\}/)
  assert.match(servicePanelSource, /classNames=\{rowTooltipClassNames\}/)
  assert.match(servicePanelSource, /styles\['service-operation-notification'\]/)
  assert.match(servicePanelSource, /className:\s*styles\['service-action-confirm'\]/)
})

test('Docker 面板使用私有 Module 类并只局部开放 Portal 第三方节点', () => {
  assert.doesNotMatch(docker.source, /stylelint-disable[^\n]*termous\/no-unscoped-global/)
  assert.doesNotMatch(docker.source, /:global\s*\{/)
  assert.doesNotMatch(docker.source, /\.docker-filter-popover:global\(\.ant-popover\)/)
  assert.match(
    docker.source,
    /\.docker-logs-modal-root \.docker-logs-modal:global\(\.ant-modal\)/,
  )
  assert.match(dockerSource, /styles\['docker-panel'\]/)
  assert.match(dockerSource, /<FilterPopover/)
  assert.match(dockerSource, /rootClassName=\{styles\['docker-logs-modal-root'\]\}/)
  assert.match(dockerSource, /className=\{styles\['docker-logs-modal'\]\}/)
})

test('服务日志弹窗通过 Module 类约束内部样式与 Portal', () => {
  assert.doesNotMatch(serviceLogs.source, /:global\s*\{/)
  assert.doesNotMatch(serviceLogs.source, /termous\/no-unscoped-global/)
  assert.match(serviceLogsSource, /className=\{styles\.modal\}/)
  assert.match(serviceLogsSource, /className=\{styles\.tool\}/)
  assert.match(serviceLogsSource, /classNames=\{tooltipClassNames\}/)
  assert.match(serviceLogsSource, /classNames=\{selectClassNames\}/)
})

test('共享检测加载状态由组件 Module 私有类承载', () => {
  assert.doesNotMatch(detection.source, /:global|stylelint-disable/)
  assert.match(detection.source, /\.root\s*{[^}]*min-height:\s*150px/)
  assert.match(detection.source, /\.card\s*{[^}]*padding:\s*18px/)
})

test('远端管理共享弹层显式接入 Module', () => {
  const selectStyles = readStyle('../shared/ui/CustomSelect.module.scss')
  const primitiveStyles = readStyle('../shared/ui/Primitives.module.scss')

  assert.match(selectStyles.source, /^\.select-dropdown:global\(\.ant-select-dropdown\)/m)
  assert.match(primitiveStyles.source, /^\.tooltip:global\(\.ant-tooltip\)/m)
  assert.match(dockerSource, /customSelectStyles\['select-dropdown'\]/)
  assert.match(servicePanelSource, /customSelectStyles\['select-dropdown'\]/)
})

test('远端管理关键滚动与弹层尺寸保持不变', () => {
  assert.match(servicePanel.source, /\.service-list,\s*\.service-detail\s*{[^}]*overflow-y:\s*auto/)
  assert.match(serviceLogs.source, /\.console\s*{[^}]*overflow:\s*auto/)
  assert.match(docker.source, /\.docker-log-section pre\s*{[^}]*max-height:\s*220px/)
  assert.match(
    firewall.source,
    /\.firewall-rule-modal-root \.firewall-rule-modal:global\(\.ant-modal\) :global\(\.ant-modal-body\),[\s\S]*?overflow:\s*auto/,
  )
  assert.match(detection.source, /\.root\s*{[^}]*min-height:\s*150px/)
})
