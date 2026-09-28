import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type TranscriptContext,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import {
  createRuntimeCompactionController,
  type RuntimeCompactionActivity,
  type RuntimeCompactionCommit,
  type RuntimeCompactionContextUsage,
  type RuntimeCompactionOptions,
} from './runtimeCompaction.ts'
import { runtimeCompactionEmptyUsage } from './runtimeCompactionPolicy.ts'
import type { RuntimeUsage } from './runtimeUsage.ts'

export const compactionTestModel: Model<'openai-completions'> = {
  id: 'test-model',
  name: 'Test model',
  api: 'openai-completions',
  provider: 'test-provider',
  baseUrl: 'http://127.0.0.1:1234/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8000,
  maxTokens: 1600,
}

export function compactionTestUser(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 1 }
}

export function compactionTestAssistant(text: string, tokens = 0): AssistantMessage {
  return {
    role: 'assistant',
    api: compactionTestModel.api,
    model: compactionTestModel.id,
    provider: compactionTestModel.provider,
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp: 2,
    usage: {
      ...runtimeCompactionEmptyUsage,
      input: tokens,
      totalTokens: tokens,
      cost: { ...runtimeCompactionEmptyUsage.cost },
    },
  }
}

export function compactionTestHistory(): AgentMessage[] {
  return [
    compactionTestUser('old-user-1 ' + 'a'.repeat(4000)),
    compactionTestAssistant('old-assistant-1 ' + 'b'.repeat(4000)),
    compactionTestUser('old-user-2 ' + 'c'.repeat(4000)),
    compactionTestAssistant('old-assistant-2 ' + 'd'.repeat(4000)),
    compactionTestUser('recent-user ' + 'e'.repeat(4000)),
    compactionTestAssistant('recent-assistant ' + 'f'.repeat(4000), 7000),
    compactionTestUser('继续当前任务'),
  ]
}

export function compactionTestToolHistory(): AgentMessage[] {
  const messages: AgentMessage[] = []
  for (let index = 0; index < 6; index += 1) {
    messages.push({
      ...compactionTestAssistant('', index === 5 ? 7000 : 0),
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: `tool-${index}`, name: 'remote_read', arguments: { path: '/var/log/app' } }],
    })
    messages.push({
      role: 'toolResult', toolCallId: `tool-${index}`, toolName: 'remote_read',
      content: [{ type: 'text', text: `result-${index} ` + 'z'.repeat(4000) }],
      isError: false, timestamp: 3,
    })
  }
  return messages
}

export function compactionTestStream(
  response: AssistantMessage | ((context: TranscriptContext, options?: SimpleStreamOptions) => Promise<AssistantMessage>),
): StreamFn {
  return async (_model, context, options) => {
    const stream = createAssistantMessageEventStream()
    const message = typeof response === 'function' ? await response(context, options) : response
    stream.end(message)
    return stream
  }
}

export function createCompactionTestHarness(overrides: Partial<RuntimeCompactionOptions<string>> = {}) {
  const activities: RuntimeCompactionActivity[] = []
  const commits: RuntimeCompactionCommit<string>[] = []
  const usages: RuntimeUsage[] = []
  const contexts: RuntimeCompactionContextUsage[] = []
  const requests: Array<{ context: TranscriptContext; options?: SimpleStreamOptions }> = []
  const order: string[] = []
  const controller = createRuntimeCompactionController({
    model: compactionTestModel,
    systemPrompt: '',
    tools: [],
    streamFn: compactionTestStream(async (context, options) => {
      requests.push({ context, options })
      order.push('summary')
      return compactionTestAssistant('## Goal\n继续原任务。\n## Next Steps\n1. 完成剩余工作。', 100)
    }),
    captureSource: async () => {
      order.push('capture')
      return 'source-snapshot'
    },
    commit: async (candidate) => {
      order.push('commit')
      commits.push(candidate)
    },
    onActivity: (activity) => {
      order.push(activity.status)
      activities.push(activity)
    },
    onUsage: (usage) => { usages.push(usage) },
    onContextUsage: (usage) => { contexts.push(usage) },
    now: () => 1234,
    ...overrides,
  })
  return { controller, activities, commits, usages, contexts, requests, order }
}
