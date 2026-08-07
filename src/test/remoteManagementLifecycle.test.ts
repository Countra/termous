import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const workbenchSource = readFileSync(
  fileURLToPath(new URL('../widgets/workbench/ui/WorkbenchPage.tsx', import.meta.url)),
  'utf8',
)
const firewallSource = readFileSync(
  fileURLToPath(new URL('../features/firewall/ui/FirewallPanel.tsx', import.meta.url)),
  'utf8',
)
const firewallPersistenceSource = readFileSync(
  fileURLToPath(new URL('../features/firewall/ui/FirewallPersistencePanel.tsx', import.meta.url)),
  'utf8',
)
const servicePanelSource = readFileSync(
  fileURLToPath(new URL('../features/service/ui/ServicePanel.tsx', import.meta.url)),
  'utf8',
)
const dockerPanelSource = readFileSync(
  fileURLToPath(new URL('../features/docker/ui/DockerPanel.tsx', import.meta.url)),
  'utf8',
)

test('工作台隐藏时停止远端管理读取和轮询', () => {
  assert.match(
    workbenchSource,
    /enabled=\{active && detailsActiveTab === 'services' && !detailsCollapsed\}/,
  )
  assert.match(
    workbenchSource,
    /enabled=\{active && detailsActiveTab === 'docker' && !detailsCollapsed\}/,
  )
  assert.match(
    workbenchSource,
    /enabled=\{active && detailsActiveTab === 'firewall' && !detailsCollapsed\}/,
  )
  assert.match(
    firewallSource,
    /if \(!enabled\) \{\s*abortLoad\(\)\s*setPersistenceOpen\(false\)\s*setEditing\(null\)\s*setDeleteConfirmKey\(null\)\s*destroyRiskConfirm\(\)\s*setLoading\(false\)\s*return\s*\}/,
  )
  assert.match(
    firewallSource,
    /if \(!connectedLinux\) \{\s*abortLoad\(\)\s*abortApply\(\)/,
  )
})

test('远端管理失活时关闭 Portal，且防火墙写请求不被只读清理取消', () => {
  assert.match(servicePanelSource, /if \(!enabled\) \{\s*setLogsOpen\(false\)\s*destroyActionConfirm\(\)/)
  assert.match(servicePanelSource, /!scope\.enabled[\s\S]*scope\.sessionId !== expectedSessionId[\s\S]*scope\.selectedUnitId !== unitId/)
  assert.match(servicePanelSource, /setMoreActionsOpen\(false\)\s*\}, \[detailUnitId, enabled\]\)/)
  assert.match(servicePanelSource, /open=\{moreActionsOpen\}[\s\S]*onOpenChange=\{\(open\) => setMoreActionsOpen\(enabled && open\)\}/)
  assert.match(dockerPanelSource, /if \(!enabled\) \{\s*setLogsOpen\(false\)\s*\}\s*setActionConfirm\(null\)/)
  assert.match(dockerPanelSource, /open=\{actionConfirm === 'stop'\}/)
  assert.match(dockerPanelSource, /open=\{actionConfirm === 'restart'\}/)
  assert.match(dockerPanelSource, /!scope\.enabled \|\| scope\.selectedRef !== ref/)
  assert.match(firewallSource, /!enabledRef\.current \|\| !targetSessionId/)
  assert.match(firewallSource, /setDeleteConfirmKey\(null\)\s*destroyRiskConfirm\(\)/)
  assert.match(firewallSource, /open=\{deleteConfirmOpen\}/)
  assert.match(
    firewallPersistenceSource,
    /if \(activeRequestRef\.current\?\.kind === 'write'\) \{\s*return null\s*\}/,
  )
  assert.match(
    firewallPersistenceSource,
    /if \(open && sessionConnected\) \{\s*return\s*\}\s*abortActiveRead\(\)\s*setLoading\(false\)/,
  )
})
