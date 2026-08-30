import type {
  AgentMessage,
  AgentMessagePart,
  AgentRun,
  AgentRunEvent,
  AgentSession,
} from '#entities/agent'

export const agentFixtureTime = '2026-08-29T00:00:00Z'

export function agentSessionFixture(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'ags-session',
    title: '测试会话',
    model_id: 'apm-model',
    reasoning_level: 'medium',
    revision: 1,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    ...overrides,
  }
}

export function agentRunFixture(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'agr-run',
    client_request_id: 'request-1',
    session_id: 'ags-session',
    generation: 1,
    event_sequence: 0,
    status: 'running',
    user_message_id: 'agm-user',
    assistant_message_id: 'agm-assistant',
    provider_id: 'apv-provider',
    model_id: 'apm-model',
    model_snapshot: {
      api_mode: 'responses',
      base_url: 'https://model.example.test/v1',
      model_id: 'test-model',
      provider_id: 'apv-provider',
      provider_name: '测试 Provider',
      model_display_name: '测试模型',
      provider_revision: 1,
      model_revision: 1,
      context_window_tokens: 32_768,
      max_output_tokens: 4_096,
      supports_images: false,
      supports_reasoning: true,
    },
    reasoning_level: 'medium',
    usage: {
      input_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
      estimated: false,
    },
    revision: 1,
    queued_at: agentFixtureTime,
    started_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    ...overrides,
  }
}

export function agentMessageFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'agm-assistant',
    session_id: 'ags-session',
    role: 'assistant',
    status: 'pending',
    sequence: 2,
    revision: 1,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    parts: [],
    attachments: [],
    ...overrides,
  }
}

export function agentTextPartFixture(
  overrides: Partial<Extract<AgentMessagePart, { kind: 'text' }>> = {},
): Extract<AgentMessagePart, { kind: 'text' }> {
  return {
    id: 'agp-text',
    message_id: 'agm-assistant',
    sequence: 1,
    revision: 1,
    created_at: agentFixtureTime,
    updated_at: agentFixtureTime,
    kind: 'text',
    text: '完成内容',
    ...overrides,
  }
}

export function agentDeltaEventFixture(
  overrides: Partial<Extract<AgentRunEvent, { kind: 'message_delta' }>> = {},
): Extract<AgentRunEvent, { kind: 'message_delta' }> {
  return {
    id: 'age-delta-1',
    run_id: 'agr-run',
    generation: 1,
    sequence: 1,
    kind: 'message_delta',
    payload: {
      message_delta: {
        message_id: 'agm-assistant',
        part_id: 'agp-text',
        kind: 'text',
        delta: '你',
      },
    },
    created_at: agentFixtureTime,
    ...overrides,
  }
}

export function agentStatusEventFixture(
  overrides: Partial<Extract<AgentRunEvent, { kind: 'status' }>> = {},
): Extract<AgentRunEvent, { kind: 'status' }> {
  return {
    id: 'age-status-1',
    run_id: 'agr-run',
    generation: 1,
    sequence: 1,
    kind: 'status',
    payload: { status: { status: 'running' } },
    created_at: agentFixtureTime,
    ...overrides,
  }
}
