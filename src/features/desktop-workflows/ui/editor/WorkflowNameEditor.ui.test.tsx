import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { WorkflowNameEditor } from './WorkflowNameEditor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function Editor() {
  const [name, setName] = useState('部署检查')
  return <WorkflowNameEditor value={name} disabled={false} onChange={setName} />
}
function edit(value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.editName' }))
  const input = screen.getByRole('textbox', { name: 'desktopWorkflow.scriptName' })
  fireEvent.change(input, { target: { value } })
  return input
}

it('名称以标题展示，按需编辑，确认修剪空格，撤销恢复进入编辑时的名称', () => {
  render(<Editor />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.keyDown(edit(' 新名称 '), { key: 'Enter' })
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('新名称')
  fireEvent.keyDown(edit('放弃的修改'), { key: 'Escape' })
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('新名称')
  edit('按钮撤销')
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.cancel' }))
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('新名称')
})

it('中文输入法确认不退出编辑，空白名称失焦恢复原值，编辑按钮受忙碌状态约束', () => {
  const view = render(<Editor />)
  const input = edit('部署新版')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(input).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.blur(input)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('部署检查')
  view.rerender(<WorkflowNameEditor value="保存中" disabled onChange={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'desktopWorkflow.editName' })).toBeDisabled()
})
