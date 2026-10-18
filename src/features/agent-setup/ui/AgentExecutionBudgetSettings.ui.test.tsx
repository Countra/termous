import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { defaultExecutionBudget } from '#common/contracts'
import type { AgentConfigurationDraft } from '../model/agentConfigurationDraft'
import { validateAgentConfiguration } from '../model/agentConfigurationDraft'
import type { AgentConfigurationEditor } from '../model/useAgentConfiguration'
import { AgentExecutionBudgetSettings } from './AgentExecutionBudgetSettings'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function renderBudget(enabled = false, busy = false) {
  const change = vi.fn()
  function Form() {
    const [draft, setDraft] = useState({ budgetEnabled: enabled, ...defaultExecutionBudget.limits,
      model_requests: 200 } as AgentConfigurationDraft)
    const errors = validateAgentConfiguration(draft, key => key)
    const editor = { draft, errors, busy, change: (patch: Partial<AgentConfigurationDraft>) => {
      change(patch)
      setDraft(current => ({ ...current, ...patch }))
    } } as AgentConfigurationEditor
    return <AgentExecutionBudgetSettings editor={editor} />
  }
  render(<Form />)
  return change
}

it('启停仅更新页面草稿，关闭再开启保留填写的限额', () => {
  const change = renderBudget()
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  fireEvent.click(screen.getByRole('switch'))
  expect(change).toHaveBeenLastCalledWith({ budgetEnabled: true })
  const input = screen.getByRole('spinbutton', { name: 'settings.agent.executionLimits.model_requests.title' })
  fireEvent.change(input, { target: { value: '250' } })
  fireEvent.blur(input)
  expect(change).toHaveBeenLastCalledWith({ model_requests: 250 })
  expect(input).toHaveValue('250')
  fireEvent.click(screen.getByRole('switch'))
  fireEvent.click(screen.getByRole('switch'))
  expect(screen.getByRole('spinbutton', { name: 'settings.agent.executionLimits.model_requests.title' })).toHaveValue('250')
})

it.each(['', '1.5', '501', '0'])('非法限额 %s 保留输入并显示校验，关闭后仍可修复', value => {
  renderBudget(true)
  const input = screen.getByRole('spinbutton', { name: 'settings.agent.executionLimits.model_requests.title' })
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('alert')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch'))
  expect(input).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '300' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('统一保存期间禁止重复切换与修改', () => {
  renderBudget(true, true)
  expect(screen.getByRole('switch')).toBeDisabled()
  for (const input of screen.getAllByRole('spinbutton')) expect(input).toBeDisabled()
})
