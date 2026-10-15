import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { Type } from 'typebox'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { RuntimeSkillContext, skillResourceMarker } from './runtimeSkillContext.ts'
import { createAgentSkillBundleSnapshot } from '../contracts/skillBundle.ts'

test('workflow 根说明不依赖正文工具名，截图语义搜索只加载创建入口', async () => {
  const names = ['schema', 'list', 'get', 'captures.create', 'captures.release', 'templates.preview', 'delete'].map((name) => `termous.desktop_workflows.${name}`)
  const tools = names.map((name) => ({ name, label: name, description: 'workflow 快照截图', parameters: Type.Object({}), execute: async () => ({ content: [], details: {} }) }))
  const discovery = new RuntimeToolDiscovery(tools, (name) => name, [])
  assert.deepEqual(discovery.loadReferencedTools('只有流程说明，不写工具名称', 'skill://termous-desktop-workflows/SKILL.md').map((tool) => tool.original_name), names.slice(0, 4))
  for (const query of ['workflow 截图', '创建快照']) {
    const result = await discovery.tool.execute('call', { query })
    const data = JSON.parse(result.content.find((part) => part.type === 'text')!.text)
    assert.deepEqual(data.tools.map((tool: { original_name: string }) => tool.original_name), ['termous.desktop_workflows.captures.create'])
  }
  const restricted = new RuntimeToolDiscovery(tools.filter((tool) => !tool.name.endsWith('captures.create')), (name) => name, [])
  assert.deepEqual(restricted.loadNames(['termous.desktop_workflows.captures.create']), [])
})

test('能力文档只在 URI、哈希和正文同时存在时去重，压缩移除后重新提供', () => {
  const content = '固定快照流程'
  const resource = { uri: 'skill://termous-desktop-workflows/references/templates.md', content, sha256: createHash('sha256').update(content).digest('hex'), size: Buffer.byteLength(content), media_type: 'text/markdown; charset=utf-8' as const }
  const rootURI = 'skill://termous-desktop-workflows/SKILL.md'
  const context = new RuntimeSkillContext(createAgentSkillBundleSnapshot([{ name: 'termous-desktop-workflows', description: '固定快照', entry_uri: rootURI }], [resource, { ...resource, uri: rootURI }]))
  context.activateTool('termous.desktop_workflows.captures.create')
  assert.equal(context.content([]).length, 2)
  const message = { role: 'user' as const, timestamp: 0, content: [{ type: 'text' as const, text: content }] }
  assert.equal(context.content([message]).length, 2)
  const present = { ...message, content: [...message.content, { type: 'text' as const, text: skillResourceMarker(resource) }] }
  assert.equal(context.content([present]).length, 0)
  assert.equal(context.content([{ ...present, content: [...message.content, { type: 'text', text: skillResourceMarker({ ...resource, sha256: 'old' }) }] }]).length, 2)
  assert.equal(context.content([]).length, 2)
})
