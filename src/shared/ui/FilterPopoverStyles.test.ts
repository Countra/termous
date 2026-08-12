import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const componentSource = readFileSync(fileURLToPath(new URL('./FilterPopover.tsx', import.meta.url)), 'utf8')
const styleSource = readFileSync(fileURLToPath(new URL('./FilterPopover.module.scss', import.meta.url)), 'utf8')
const consumerSources = [
  '../../features/snippets/ui/SnippetCatalog.tsx',
  '../../features/hosts/ui/HostCatalog.tsx',
  '../../features/docker/ui/DockerPanel.tsx',
  '../../features/service/ui/ServicePanel.tsx',
  '../../features/observability/ui/ProcessPanel.tsx',
  '../../features/command-dispatch/ui/CommandDispatchTargetPicker.tsx',
].map((relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'))

test('筛选浮层由共享组件统一约束外框和圆角裁剪', () => {
  assert.match(componentSource, /container:\s*styles\.surface/)
  assert.match(componentSource, /root:\s*rootClassName/)
  assert.match(styleSource, /\.surface:global\(\.ant-popover-container\)[\s\S]*overflow:\s*hidden/)
  assert.match(styleSource, /\.root:global\(\.ant-popover\) :global\(\.ant-popover-content\)[\s\S]*background:\s*transparent !important/)
})

test('业务筛选弹层统一复用共享外框', () => {
  for (const source of consumerSources) {
    assert.match(source, /<FilterPopover/)
  }
})
