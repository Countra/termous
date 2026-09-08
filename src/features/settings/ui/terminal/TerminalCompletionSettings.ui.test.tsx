import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { defaultCompletionSettings } from '#entities/settings'
import { TerminalCompletionSettings } from './TerminalCompletionSettings.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('终端 AI 补全设置', () => {
  it('默认关闭，保存只更改 AI 开关并沿用忙碌保护', async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    const onChange = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    render(<TerminalCompletionSettings value={defaultCompletionSettings} disabled={false} onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'settings.completionAiEnabled' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith({ ...defaultCompletionSettings, ai_enabled: true })
    expect(toggle).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'settings.completionEnabled' })).toBeDisabled()
    await act(async () => { resolve() })
    expect(toggle).toBeEnabled()
  })

  it('总开关关闭暂停 AI，保留已选值；模型不可用仍可前往设置', async () => {
    const user = userEvent.setup()
    const onOpenAgentSettings = vi.fn()
    render(<TerminalCompletionSettings value={{ ...defaultCompletionSettings, enabled: false, ai_enabled: true }} disabled={false}
      onChange={vi.fn()} modelStatus={{ status: 'unavailable', reason: 'not_configured' }} onOpenAgentSettings={onOpenAgentSettings} />)
    const toggle = screen.getByRole('switch', { name: 'settings.completionAiEnabled' })
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()
    expect(screen.getByText('terminal.aiCompletion.modelNotConfigured')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'terminal.aiCompletion.openSettings' }))
    expect(onOpenAgentSettings).toHaveBeenCalledOnce()
  })

  it('展示只读默认模型，模型不可用不会改变独立来源的选中状态', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(async () => undefined)
    render(<TerminalCompletionSettings value={defaultCompletionSettings} disabled={false} onChange={onChange}
      modelStatus={{ status: 'ready', label: 'shared-default-model' }} />)
    expect(screen.getByText(/shared-default-model/)).toBeVisible()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByText('settings.completionProviders'))
    await user.click(screen.getByRole('switch', { name: 'settings.completionProvider.history.name' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultCompletionSettings, providers: { ...defaultCompletionSettings.providers, history: false } })
  })
})
