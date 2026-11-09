import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const anchorContracts = [
  {
    name: '工作台工具区',
    source: source('../widgets/workbench/ui/WorkbenchDetailsPanel.tsx'),
    pattern: /<FeatureSidePanel<DetailsTabKey>[\s\S]*?data-tour="workbench-tools"/,
  },
  {
    name: '文件工作区',
    source: source('../widgets/files-workspace/ui/FilesWorkspace.tsx'),
    pattern: /<main className=\{styles\['files-main-panel'\]\} data-tour="files-workspace">/,
  },
  {
    name: '端口转发总览',
    source: source('../features/forwards/ui/ForwardManagementWorkspace.tsx'),
    pattern: /forwarding-commandbar'[\s\S]*?data-tour="forwards-overview"/,
  },
  {
    name: '代码片段工作区',
    source: source('../features/snippets/ui/SnippetManagementWorkspace.tsx'),
    pattern: /<section[\s\S]*?data-tour="snippets-workspace"/,
  },
  {
    name: '设置工作区',
    source: source('../pages/settings/ui/SettingsWorkspace.tsx'),
    pattern: /<section className=\{styles\.workspace\} data-tour="settings-workspace">/,
  },
] as const

for (const contract of anchorContracts) {
  test(`${contract.name} 保持产品向导稳定锚点`, () => {
    assert.match(contract.source, contract.pattern)
  })
}

const featureAnchors = [
  ['助手会话扩展', '../features/agent-integrations/ui/IntegrationSourcePicker.tsx', 'agent-extensions'],
  ['会话本地工作区', '../features/agent-local-tools/ui/LocalDirectoryPicker.tsx', 'agent-local-workspace'],
  ['本机桌面权限', '../features/agent-setup/ui/AgentHostDesktopSettings.tsx', 'agent-host-desktop'],
  ['助手独立窗口', '../pages/agent/ui/AgentWindowButton.tsx', 'agent-window'],
  ['自动化画面分析', '../features/desktop-workflows/ui/analysis/WorkflowAnalysis.tsx', 'automation-analysis'],
  ['自动化功能菜单', '../features/desktop-workflows/ui/editor/WorkflowActionsMenu.tsx', 'automation-functions'],
  ['自动化总览导入', '../features/desktop-workflows/ui/catalog/WorkflowOverview.tsx', 'automation-import'],
  ['自动化独立窗口', '../features/desktop-workflows/ui/WorkflowWorkspace.tsx', 'automation-window'],
  ['远程桌面连接状态', '../widgets/remote-desktop-workspace/ui/RemoteDesktopConnectionQuality.tsx', 'desktop-quality'],
  ['网络代理', '../features/settings/ui/connection/LocalNetworkSettings.tsx', 'settings-network'],
] as const

for (const [name, path, anchor] of featureAnchors) {
  test(`${name} 的向导锚点位于实际功能控件`, () => {
    assert.ok(source(path).includes(`data-tour="${anchor}"`), name)
  })
}
