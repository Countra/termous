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
    source: source('../pages/settings/ui/SettingsPage.tsx'),
    pattern: /<div className=\{styles\['page-title-row'\]\} data-tour="settings-workspace">/,
  },
] as const

for (const contract of anchorContracts) {
  test(`${contract.name} 保持产品向导稳定锚点`, () => {
    assert.match(contract.source, contract.pattern)
  })
}
