import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AgentRequestUsageDetails } from './AgentRequestUsageDetails.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('请求明细默认不创建表格，展开后区分估算用量、压缩和错误状态', async () => {
  const { container } = render(<AgentRequestUsageDetails requests={[{
    request_index: 2, purpose: 'compaction', tool_count: 3, schema_bytes: 1200, schema_tokens_estimate: 400,
    images: [{ width: 1600, height: 900 }], usage: { input_tokens: 800, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 800, estimated: true },
    duration_ms: 1250, outcome: 'failed', error_code: 'AGENT_MODEL_RATE_LIMITED',
  }]} />)
  const details = container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(container.querySelector('summary')!)
  expect(details.open).toBe(true)
  await waitFor(() => expect(screen.getByRole('table')).toBeVisible())
  expect(screen.getByText('≈ 800')).toBeVisible()
  expect(screen.getByTitle('1600×900')).toHaveTextContent('1')
  expect(screen.getByTitle('AGENT_MODEL_RATE_LIMITED')).toHaveTextContent('settings.agent.requestMetrics.failed')
})
