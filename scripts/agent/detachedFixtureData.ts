import type { AgentModel, AgentReadiness } from '#entities/agent'

export function providerFixture() {
  return {
    id: 'provider-one',
    name: 'Provider One',
    api_mode: 'responses' as const,
    base_url: 'http://127.0.0.1:11434/v1',
    enabled: true,
    api_key_configured: false,
    refresh_status: 'ready' as const,
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}

export function readinessFixture(
  status: AgentReadiness['status'] = 'ready',
  defaultModelStatus: AgentReadiness['default_model']['status'] = 'ready',
): AgentReadiness {
  return {
    status,
    mcp_runtime: { status: 'ready', message: '' },
    mcp_client: { status: 'ready', message: '' },
    skills_bundle: { status: 'ready', message: '' },
    default_model: { status: defaultModelStatus, message: '' },
    mcp_policy: {
      client_id: 'mcp-one',
      approval_bypass: false,
      scope_count: 29,
      required_scope_count: 29,
      scope_sync_required: false,
      revision: 1,
    },
    settings: {
      default_model_id: 'model-one',
      default_reasoning_level: 'off',
      global_context_window_tokens: 16_384,
      global_max_output_tokens: 4_096,
      max_concurrent_runs: 4,
      context_compaction_threshold_percent: 80,
      show_turn_token_usage: true,
      connect_ssh_profile_on_bind: false,
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
    },
  }
}

export function modelFixture(id = 'model-one'): AgentModel {
  return {
    id,
    provider_id: 'provider-one',
    remote_model_id: `remote-${id}`,
    display_name: `Model ${id}`,
    availability: 'available' as const,
    source: 'sync' as const,
    parameter_mode: 'inherit_global' as const,
    context_window_tokens: 8_192,
    max_output_tokens: 1_024,
    default_reasoning_level: 'off' as const,
    reasoning_control: 'none' as const,
    supported_reasoning_levels: ['off'],
    supports_images: false,
    supports_reasoning: false,
    capabilities_confirmed: false,
    effective_context_window_tokens: 16_384,
    effective_max_output_tokens: 4_096,
    effective_default_reasoning_level: 'off' as const,
    revision: 1,
    first_seen_at: '2026-08-29T00:00:00Z',
    last_seen_at: '2026-08-29T00:00:00Z',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}
