import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentModel, AgentModelProvider } from '#entities/agent'
import {
  loadAgentModelCatalog,
  type AgentModelCatalogSource,
} from './loadAgentModelCatalog.ts'

test('Provider 与模型分页短暂错位时只重读一次完整目录', async () => {
  let providerReads = 0
  let modelReads = 0
  const source: AgentModelCatalogSource = {
    modelProviders: async () => {
      providerReads += 1
      return { items: providerReads === 1 ? [] : [providerFixture()] }
    },
    models: async () => {
      modelReads += 1
      return { items: [modelFixture()] }
    },
  }

  const catalog = await loadAgentModelCatalog(source)

  assert.equal(providerReads, 2)
  assert.equal(modelReads, 2)
  assert.equal(catalog.providers[0]?.id, 'apv-1')
  assert.equal(catalog.models[0]?.provider_id, 'apv-1')
})

test('关系错位在重读后仍存在时返回稳定失败', async () => {
  let providerReads = 0
  let modelReads = 0
  const source: AgentModelCatalogSource = {
    modelProviders: async () => {
      providerReads += 1
      return { items: [] }
    },
    models: async () => {
      modelReads += 1
      return { items: [modelFixture()] }
    },
  }

  await assert.rejects(loadAgentModelCatalog(source), /未知 Provider/)
  assert.equal(providerReads, 2)
  assert.equal(modelReads, 2)
})

test('非关系错误不触发目录重读', async () => {
  let providerReads = 0
  let modelReads = 0
  const source: AgentModelCatalogSource = {
    modelProviders: async () => {
      providerReads += 1
      throw new Error('读取失败')
    },
    models: async () => {
      modelReads += 1
      return { items: [] }
    },
  }

  await assert.rejects(loadAgentModelCatalog(source), /读取失败/)
  assert.equal(providerReads, 1)
  assert.equal(modelReads, 1)
})

test('首次目录读取期间取消后不发起关系重读', async () => {
  let providerReads = 0
  let modelReads = 0
  const controller = new AbortController()
  const source: AgentModelCatalogSource = {
    modelProviders: async () => {
      providerReads += 1
      return { items: [] }
    },
    models: async () => {
      modelReads += 1
      controller.abort(new Error('目录读取已取消'))
      return { items: [modelFixture()] }
    },
  }

  await assert.rejects(loadAgentModelCatalog(source, controller.signal), /目录读取已取消/)
  assert.equal(providerReads, 1)
  assert.equal(modelReads, 1)
})

test('Provider 按后端 32 条上限完整读取两页', async () => {
  const providers = Array.from({ length: 32 }, (_, index) => providerFixture(`apv-${index + 1}`))
  let providerReads = 0
  const source: AgentModelCatalogSource = {
    modelProviders: async (cursor) => {
      providerReads += 1
      const offset = cursor ? Number(cursor) : 0
      const items = providers.slice(offset, offset + 16)
      const nextOffset = offset + items.length
      return {
        items,
        next_cursor: nextOffset < providers.length ? String(nextOffset) : undefined,
      }
    },
    models: async () => ({ items: [] }),
  }

  const catalog = await loadAgentModelCatalog(source)

  assert.equal(providerReads, 2)
  assert.equal(catalog.providers.length, 32)
  assert.equal(catalog.providers[catalog.providers.length - 1]?.id, 'apv-32')
})

test('模型分页期间条目前移时重读并返回完整目录', async () => {
  let providerReads = 0
  let modelReads = 0
  const firstSnapshot = [
    modelFixture('apm-1'),
    modelFixture('apm-2'),
    modelFixture('apm-3'),
    modelFixture('apm-4'),
  ]
  const stableSnapshot = [
    { ...modelFixture('apm-3'), revision: 2 },
    modelFixture('apm-1'),
    modelFixture('apm-2'),
    modelFixture('apm-4'),
  ]
  const source: AgentModelCatalogSource = {
    modelProviders: async () => {
      providerReads += 1
      return { items: [providerFixture()] }
    },
    models: async (_providerId, cursor) => {
      modelReads += 1
      if (modelReads <= 3) {
        if (!cursor && modelReads === 1) return { items: firstSnapshot.slice(0, 2), next_cursor: 'first-page-2' }
        if (cursor === 'first-page-2') return { items: [firstSnapshot[3]!] }
        return { items: stableSnapshot.slice(0, 2), next_cursor: 'stable-page-2' }
      }
      if (cursor === 'stable-page-2') return { items: stableSnapshot.slice(2) }
      return { items: stableSnapshot.slice(0, 2), next_cursor: 'stable-page-2' }
    },
  }

  const catalog = await loadAgentModelCatalog(source)

  assert.equal(providerReads, 4)
  assert.equal(modelReads, 6)
  assert.deepEqual(catalog.models.map(({ id }) => id), ['apm-3', 'apm-1', 'apm-2', 'apm-4'])
})

test('模型分页持续变化时返回稳定失败', async () => {
  let revision = 1
  const source: AgentModelCatalogSource = {
    modelProviders: async () => ({ items: [providerFixture()] }),
    models: async (_providerId, cursor) => {
      if (cursor) return { items: [modelFixture('apm-2')] }
      revision += 1
      return {
        items: [{ ...modelFixture('apm-1'), revision }],
        next_cursor: 'page-2',
      }
    },
  }

  await assert.rejects(loadAgentModelCatalog(source), /读取期间持续变化/)
})

function providerFixture(id = 'apv-1'): AgentModelProvider {
  return {
    id,
    name: 'Provider',
    api_mode: 'responses',
    base_url: 'https://example.test/v1',
    enabled: true,
    api_key_configured: false,
    refresh_status: 'ready',
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}

function modelFixture(id = 'apm-1'): AgentModel {
  return {
    id,
    provider_id: 'apv-1',
    remote_model_id: 'gpt-test',
    display_name: 'GPT Test',
    availability: 'available',
    context_window_tokens: 8192,
    max_output_tokens: 1024,
    supports_images: false,
    supports_reasoning: false,
    capabilities_confirmed: false,
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}
