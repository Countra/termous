import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentRequestUsage, AgentUsage } from '#entities/agent'
import { AgentTurnUsage } from './AgentTurnUsage.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'zh-CN' } }),
}))

const usage: AgentUsage = {
  input_tokens: 120, output_tokens: 80, cache_read_tokens: 0, cache_write_tokens: 0,
  reasoning_tokens: 0, total_tokens: 200, estimated: false,
}
const requests: AgentRequestUsage[] = [{
  request_index: 1, purpose: 'response', tool_count: 3, schema_bytes: 1200, schema_tokens_estimate: 400,
  images: [], usage, duration_ms: 1250, outcome: 'completed',
}]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each([
  { name: 'Vite 开发模式', dev: true, bridge: undefined, debug: false, visible: true },
  { name: '普通构建', dev: false, bridge: undefined, debug: false, visible: false },
  ...['termous', 'termousDetached', 'termousRemote'].flatMap(bridge => [
    { name: `${bridge} 调试启动`, dev: false, bridge, debug: true, visible: true },
    { name: `${bridge} 普通启动`, dev: false, bridge, debug: false, visible: false },
  ]),
])('$name 仅按调试状态展示请求明细，本轮用量保持可见', ({ dev, bridge, debug, visible }) => {
  vi.stubEnv('DEV', dev)
  for (const name of ['termous', 'termousDetached', 'termousRemote']) vi.stubGlobal(name, undefined)
  if (bridge) vi.stubGlobal(bridge, { debugMode: debug })
  const { container } = render(<AgentTurnUsage usage={usage} requests={requests} />)

  expect(screen.getByLabelText('agent.message.turnUsage')).toBeVisible()
  expect(screen.getByText('200')).toBeVisible()
  expect(Boolean(container.querySelector('details'))).toBe(visible)
  if (visible) expect(screen.getByText('settings.agent.requestMetrics.title')).toBeVisible()
  else expect(screen.queryByText('settings.agent.requestMetrics.title')).not.toBeInTheDocument()
})

it('开发模式下没有请求记录时不展示空的明细入口', () => {
  vi.stubEnv('DEV', true)
  const { rerender } = render(<AgentTurnUsage usage={usage} requests={[]} />)
  expect(screen.queryByText('settings.agent.requestMetrics.title')).not.toBeInTheDocument()
  rerender(<AgentTurnUsage usage={usage} />)
  expect(screen.queryByText('settings.agent.requestMetrics.title')).not.toBeInTheDocument()
})
