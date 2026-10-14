import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { defaultExecutionBudget } from '#common/contracts'
import type { AgentSetupController } from '../model/useAgentSetupController.ts'
import { AgentExecutionBudgetSettings } from './AgentExecutionBudgetSettings.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)

function fixture(enabled = false) {
  const policy = { enabled, limits: { ...defaultExecutionBudget.limits, model_requests: 200 } }
  const runtime = {
    readiness: { settings: { execution_budget: policy, revision: 1 } },
    loading: false, mutation: null,
    updateSettings: vi.fn().mockResolvedValue({}),
  } as unknown as AgentSetupController
  return { runtime, policy }
}

it('关闭时只显示开关，启停保留数值且以服务端设置为准', async () => {
  const { runtime, policy } = fixture()
  const { rerender } = render(<AgentExecutionBudgetSettings runtime={runtime} />)
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => expect(runtime.updateSettings).toHaveBeenCalledWith({ execution_budget: { ...policy, enabled: true } }))
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  policy.enabled = true
  rerender(<AgentExecutionBudgetSettings runtime={runtime} />)
  expect(screen.getAllByRole('spinbutton')).toHaveLength(4)
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => expect(runtime.updateSettings).toHaveBeenLastCalledWith({ execution_budget: { ...policy, enabled: false } }))
})

it('合法整数更新不覆盖其他限额，保存失败撤回输入，修订更新重置字段', async () => {
  const { runtime, policy } = fixture(true)
  const { rerender } = render(<AgentExecutionBudgetSettings runtime={runtime} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.agent.executionLimits.model_requests.title' })
  vi.mocked(runtime.updateSettings).mockRejectedValueOnce(new Error('保存失败'))
  fireEvent.change(input, { target: { value: '250' } })
  fireEvent.blur(input)
  await waitFor(() => expect(runtime.updateSettings).toHaveBeenCalledWith({ execution_budget: { ...policy, limits: { ...policy.limits, model_requests: 250 } } }))
  await waitFor(() => expect(input).toHaveValue('200'))
  policy.limits.model_requests = 300
  runtime.readiness!.settings.revision++
  rerender(<AgentExecutionBudgetSettings runtime={runtime} />)
  expect(screen.getByRole('spinbutton', { name: 'settings.agent.executionLimits.model_requests.title' })).toHaveValue('300')
})

it.each(['', '1.5', '501', '0'])('非法限额 %s 不发送保存请求', (value) => {
  const { runtime } = fixture(true)
  render(<AgentExecutionBudgetSettings runtime={runtime} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.agent.executionLimits.model_requests.title' })
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
  expect(runtime.updateSettings).not.toHaveBeenCalled()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

it('保存期间禁止重复切换与修改', () => {
  const { runtime } = fixture(true)
  runtime.mutation = 'settings'
  render(<AgentExecutionBudgetSettings runtime={runtime} />)
  expect(screen.getByRole('switch')).toBeDisabled()
  for (const input of screen.getAllByRole('spinbutton')) expect(input).toBeDisabled()
})
