import type { RuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'

export function runtimeBootstrap(): RuntimeBootstrap {
  return {
    core_instance_id: 'core-1',
    run: {
      id: 'agr_test',
      session_id: 'ags_test',
      generation: 1,
      event_sequence: 1,
      status: 'starting',
      assistant_message_id: 'agm_reply',
      provider_id: 'amp_provider',
      model_id: 'apm_model',
      reasoning_level: 'off',
    },
    session: { id: 'ags_test' },
    messages: [],
    runtime_bearer: 'r'.repeat(48),
    mcp: {
      endpoint: '/mcp',
      bearer_token: 'm'.repeat(48),
      protocol_version: '2025-11-25',
    },
    model: {
      snapshot: {
        api_mode: 'chat_completions',
        base_url: 'http://127.0.0.1:11434/v1',
        model_id: 'test-model',
        provider_id: 'amp_provider',
        provider_name: '本地 Provider',
        model_display_name: '测试模型',
        provider_revision: 3,
        model_revision: 5,
        context_window_tokens: 8192,
        max_output_tokens: 1024,
        supports_images: false,
        reasoning_control: 'none',
        supported_reasoning_levels: ['off'],
      },
    },
    context: { estimated_tokens: 1280, warning: false },
  }
}

export function runtimePart(
  kind: 'text' | 'reasoning' | 'tool_call' | 'tool_result',
  sequence: number,
  content: Record<string, unknown>,
) {
  return {
    id: `agp_${sequence}`,
    message_id: 'agm_test',
    kind,
    sequence,
    content,
  }
}

export function runtimeUserMessage(
  attachments: RuntimeBootstrap['messages'][number]['attachments'],
  text: Record<string, unknown> = { text: '检查附件' },
) {
  return {
    id: 'agm_user',
    role: 'user' as const,
    status: 'completed',
    sequence: 1,
    created_at: '2026-08-28T00:00:00Z',
    parts: [runtimePart('text', 1, { text })],
    attachments,
  }
}
