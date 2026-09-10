import type { TerminalAICompletionRequest } from '#common/contracts'
import type { TerminalCompletionBootstrap } from './protocol.ts'

export function completionTestRequest(): TerminalAICompletionRequest {
  return { requestId: 'req_test', sessionId: 'session_test', prompt: '查看磁盘使用情况', inputSnapshot: {
    sourceGeneration: 1, shellId: 'shell_test', promptGeneration: 3, inputEpoch: 4,
    line: 'df', cursorUtf16: 2, revision: 7,
  } }
}

export function completionTestBootstrap(): TerminalCompletionBootstrap {
  return {
    request_id: 'req_test', environment: { os: 'linux', shell: 'bash', cwd: '/home/test' },
    model: { api_key: 'fixture-secret', snapshot: {
      api_mode: 'responses', base_url: 'http://127.0.0.1:19999/v1', model_id: 'test-model',
      provider_id: 'provider_test', provider_name: '测试 Provider', model_display_name: '测试模型',
      provider_revision: 1, model_revision: 1, context_window_tokens: 100000, max_output_tokens: 8000,
      supports_images: false, reasoning_control: 'openai_effort', supported_reasoning_levels: ['low', 'high'],
    } },
  }
}
