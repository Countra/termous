import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { AgentConfigurationDraft } from '../model/agentConfigurationDraft'
import type { AgentConfigurationEditor } from '../model/useAgentConfiguration'
import { AgentHostDesktopSettings } from './AgentHostDesktopSettings'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const key = (name: string) => `settings.agent.hostDesktop.${name}`
const toggle = (name: string) => screen.getByRole('switch', { name: key(name) })

function setup({ busy = false, available = true } = {}) {
  const change = vi.fn()
  function Form() {
    const [draft, setDraft] = useState({ hostRead: false, hostCapture: false, hostControl: false, hostSecureCapture: false, hostSecureControl: false } as AgentConfigurationDraft)
    const editor = { draft, busy, change: (patch: Partial<AgentConfigurationDraft>) => {
      change(patch)
      setDraft(current => ({ ...current, ...patch }))
    } } as AgentConfigurationEditor
    return <AgentHostDesktopSettings editor={editor} available={available} />
  }
  render(<Form />)
  return change
}

it('开关保持原有依赖关系，关闭上级权限时同步关闭依赖项', () => {
  const change = setup()
  for (const input of screen.getAllByRole('switch')) expect(input).not.toBeChecked()
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(toggle('control'))
  for (const name of ['read', 'capture', 'control']) expect(toggle(name)).toBeChecked()
  expect(toggle('secureCapture')).not.toBeChecked()
  expect(toggle('secureControl')).not.toBeChecked()
  fireEvent.click(toggle('secureControl'))
  for (const input of screen.getAllByRole('switch')) expect(input).toBeChecked()
  fireEvent.click(toggle('capture'))
  expect(toggle('read')).toBeChecked()
  expect(toggle('capture')).not.toBeChecked()
  expect(toggle('control')).not.toBeChecked()
  fireEvent.click(toggle('capture'))
  expect(toggle('read')).toBeChecked()
  expect(toggle('capture')).toBeChecked()
  expect(toggle('control')).not.toBeChecked()
  fireEvent.click(toggle('read'))
  for (const input of screen.getAllByRole('switch')) expect(input).not.toBeChecked()
  fireEvent.click(toggle('read'))
  expect(toggle('read')).toBeChecked()
  expect(toggle('capture')).not.toBeChecked()
  expect(toggle('control')).not.toBeChecked()
})

it.each([{ busy: true }, { available: false }])('保存中或权限不可用时禁止修改：%j', options => {
  const change = setup(options)
  for (const input of screen.getAllByRole('switch')) {
    expect(input).toBeDisabled()
    fireEvent.click(input)
  }
  expect(change).not.toHaveBeenCalled()
})

it('开关关联用途与焦点说明，权限说明可通过键盘焦点查看', async () => {
  setup()
  expect(screen.getByRole('region', { name: key('title') })).toBeVisible()
  expect(toggle('read')).toHaveAccessibleDescription(key('readHint'))
  expect(toggle('capture')).toHaveAccessibleDescription(key('captureHint'))
  expect(toggle('control')).toHaveAccessibleDescription(`${key('controlHint')} ${key('focusHint')}`)
  fireEvent.focus(screen.getByRole('button', { name: key('details') }))
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip).toHaveTextContent(key('description'))
  expect(tooltip).toHaveTextContent(key('dependencies'))
})
