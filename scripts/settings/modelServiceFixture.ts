import type { AgentModel, AgentModelProvider, AgentSettings } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import { TermousApiError } from '#shared/api'

// 只在设置预览中保存内存状态，不调用模型服务，也不存储输入的密钥。
export function createModelServiceFixture(settings: () => AgentSettings, failFirstWrite = false) {
  const timestamp = '2026-10-18T02:30:00Z'
  let providers: AgentModelProvider[] = [
    { id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', api_mode: 'responses', enabled: true, api_key_configured: true, refresh_status: 'ready', last_refresh_success_at: timestamp, revision: 1, created_at: timestamp, updated_at: timestamp },
    { id: 'gateway', name: '团队模型网关', base_url: 'https://ai.example.com/v1', api_mode: 'chat_completions', enabled: true, api_key_configured: true, refresh_status: 'ready', last_refresh_success_at: timestamp, revision: 1, created_at: timestamp, updated_at: timestamp },
    { id: 'local', name: '本地模型', base_url: 'http://127.0.0.1:11434/v1', api_mode: 'chat_completions', enabled: false, api_key_configured: false, refresh_status: 'never', revision: 1, created_at: timestamp, updated_at: timestamp },
  ]
  let models: AgentModel[] = [
    ['openai', 'gpt-5.4', 'GPT 5.4'], ['openai', 'gpt-5.4-mini', 'GPT 5.4 Mini'],
    ['openai', 'gpt-5.4-pro', 'GPT 5.4 Pro'], ['gateway', 'qwen3.5', 'Qwen 3.5'],
    ['gateway', 'deepseek-v3.2', 'DeepSeek V3.2'],
  ].map(([provider_id, remote_model_id, display_name], index) => ({
    id: `model-${index}`, provider_id: provider_id!, remote_model_id: remote_model_id!, display_name: display_name!,
    availability: 'available', source: 'sync', parameter_mode: 'inherit_global', context_window_tokens: 131_072,
    max_output_tokens: 8_192, default_reasoning_level: 'medium', reasoning_control: 'openai_effort',
    supported_reasoning_levels: ['off', 'low', 'medium', 'high'], supports_images: true, supports_reasoning: true,
    capabilities_confirmed: true, effective_context_window_tokens: 131_072, effective_max_output_tokens: 8_192,
    effective_default_reasoning_level: 'medium', first_seen_at: timestamp, last_seen_at: timestamp,
    revision: 1, created_at: timestamp, updated_at: timestamp,
  }))
  const provider = (id: string) => {
    const item = providers.find(item => item.id === id)
    if (!item) throw new Error('预览服务不存在')
    return item
  }
  const model = (id: string) => {
    const item = models.find(item => item.id === id)
    if (!item) throw new Error('预览模型不存在')
    return item
  }
  const check = (actual: number, expected: number) => {
    if (actual !== expected) throw new TermousApiError('预览版本冲突', 'AGENT_REVISION_CONFLICT', 409)
  }
  const write = () => {
    if (!failFirstWrite) return
    failFirstWrite = false
    throw new TermousApiError('预览保存失败', 'VAULT_LOCKED', 423)
  }
  const effective = (item: AgentModel): AgentModel => ({ ...item,
    effective_context_window_tokens: item.parameter_mode === 'inherit_global' ? settings().global_context_window_tokens : item.context_window_tokens,
    effective_max_output_tokens: item.parameter_mode === 'inherit_global' ? settings().global_max_output_tokens : item.max_output_tokens,
    effective_default_reasoning_level: item.parameter_mode === 'inherit_global' ? settings().default_reasoning_level : item.default_reasoning_level,
  })
  const fixture: Pick<AgentSetupGateway, 'modelProviders' | 'models' | 'model' | 'createModelProvider' | 'updateModelProvider' | 'deleteModelProvider' | 'testModelProvider' | 'refreshProviderModels' | 'createModel' | 'updateModel' | 'removeModel' | 'restoreModel' | 'testModel'> = {
    modelProviders: async () => ({ items: structuredClone(providers) }),
    models: async query => ({ items: models.filter(item => !query?.provider_id || item.provider_id === query.provider_id).map(effective) }),
    model: async id => structuredClone(effective(model(id))),
    createModelProvider: async input => {
      write()
      const item: AgentModelProvider = { id: crypto.randomUUID(), name: input.name, base_url: input.base_url,
        api_mode: input.api_mode, enabled: input.enabled, api_key_configured: Boolean(input.api_key),
        refresh_status: 'never', revision: 1, created_at: timestamp, updated_at: timestamp }
      providers.push(item)
      return structuredClone(item)
    },
    updateModelProvider: async (id, input) => {
      check(provider(id).revision, input.expected_revision)
      write()
      const item = provider(id)
      Object.assign(item, { name: input.name, base_url: input.base_url, api_mode: input.api_mode, enabled: input.enabled,
        api_key_configured: input.remove_api_key ? false : input.api_key ? true : item.api_key_configured,
        revision: item.revision + 1 })
      return structuredClone(item)
    },
    deleteModelProvider: async (id, revision) => {
      check(provider(id).revision, revision)
      providers = providers.filter(item => item.id !== id)
      models = models.filter(item => item.provider_id !== id)
    },
    testModelProvider: async () => ({ status: 'ready', latency_ms: 142, model_count: models.length, message: '' }),
    refreshProviderModels: async (id, revision) => {
      const item = provider(id)
      check(item.revision, revision)
      Object.assign(item, { refresh_status: 'ready', last_refresh_success_at: timestamp, revision: item.revision + 1 })
      return structuredClone(item)
    },
    createModel: async (id, input) => {
      if (models.some(item => item.provider_id === id && item.remote_model_id === input.remote_model_id)) {
        throw new TermousApiError('预览模型已存在', 'AGENT_MODEL_ID_CONFLICT', 409)
      }
      const { expected_revision, ...value } = input
      check(provider(id).revision, expected_revision)
      const item: AgentModel = { ...models[0]!, ...value, id: crypto.randomUUID(), provider_id: id,
        source: 'manual', supports_reasoning: value.reasoning_control !== 'none', revision: 1 }
      models.push(item)
      provider(id).revision += 1
      return { model: effective(item), provider_revision: provider(id).revision }
    },
    updateModel: async (id, input) => {
      const { expected_revision, ...value } = input
      check(model(id).revision, expected_revision)
      Object.assign(model(id), value, { supports_reasoning: value.reasoning_control !== 'none', revision: model(id).revision + 1 })
      return structuredClone(effective(model(id)))
    },
    removeModel: async (id, revision) => {
      check(model(id).revision, revision)
      model(id).removed_at = timestamp
      model(id).revision += 1
    },
    restoreModel: async (id, revision) => {
      check(model(id).revision, revision)
      delete model(id).removed_at
      model(id).revision += 1
      return structuredClone(effective(model(id)))
    },
    testModel: async id => ({ status: 'ready', latency_ms: 240, model_id: id, message: '' }),
  }
  return fixture
}
