import { fireEvent, render, screen, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import { StepTree } from './StepTree'
import type { Step } from '#entities/desktop-workflow'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const actions = () => ({ onAdd: vi.fn(), onMove: vi.fn(), onCopy: vi.fn(), onRemove: vi.fn(), onToggle: vi.fn(), onSelect: vi.fn() })
const first: Step = { id: 'first', name: '第一个动作', kind: 'capture', action: {} }
const second: Step = { id: 'second', name: '第二个动作', kind: 'delay', action: {}, delay_ms: 1000 }
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>

it('步骤菜单限制首尾移动，并将停用操作发送给当前步骤', async () => {
  const handlers = actions()
  render(<StepTree steps={[first, second]} {...handlers} />, { wrapper })
  fireEvent.click(screen.getAllByRole('button', { name: 'desktopWorkflow.stepActions' })[0]!)
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByRole('menuitem', { name: 'desktopWorkflow.moveUp' })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'desktopWorkflow.moveDown' }))
  expect(handlers.onMove).toHaveBeenCalledWith('first', 1)
  fireEvent.click(screen.getAllByRole('button', { name: 'desktopWorkflow.stepActions' })[1]!)
  const next = await screen.findByRole('menu')
  expect(within(next).getByRole('menuitem', { name: 'desktopWorkflow.moveDown' })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(within(next).getByRole('menuitem', { name: 'desktopWorkflow.disableStep' }))
  expect(handlers.onToggle).toHaveBeenCalledWith('second', true)
})

it('折叠条件分支仅隐藏子步骤，重新展开后向正确分支添加步骤', async () => {
  const handlers = actions()
  render(<StepTree steps={[{ id: 'condition', name: '条件', kind: 'if', action: {}, steps: [first], else: [second] }]} {...handlers} />, { wrapper })
  const toggle = screen.getByRole('button', { name: /desktopWorkflow.condition/ })
  fireEvent.click(toggle)
  expect(screen.queryByRole('button', { name: /第一个动作/ })).not.toBeInTheDocument()
  expect(handlers.onRemove).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  expect(screen.getByRole('button', { name: /第一个动作/ })).toBeVisible()
  const branch = screen.getByText('desktopWorkflow.otherwise').parentElement!
  fireEvent.click(within(branch).getByRole('button', { name: 'desktopWorkflow.addStep' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'desktopWorkflow.kinds.capture' }))
  expect(handlers.onAdd).toHaveBeenCalledWith('capture', 'condition', 'else')
})

it('绑定运行参数时不把静态默认值当作执行值，文本内容不进入摘要', () => {
  render(<StepTree steps={[{ ...second, bindings: { delay_ms: 'duration' } }, { id: 'text', kind: 'keyboard.text', name: '输入操作', action: { text: '不应显示的输入内容' } }]} {...actions()} />, { wrapper })
  expect(screen.getByText('desktopWorkflow.parameterizedStep')).toBeVisible()
  expect(screen.queryByText('1000 ms')).not.toBeInTheDocument()
  expect(screen.queryByText('不应显示的输入内容')).not.toBeInTheDocument()
})

it('受控分支折叠由宿主持有，视图重新挂载后仍保留折叠状态', () => {
  const props = { steps: [{ id: 'condition', name: '条件', kind: 'if' as const, action: {}, steps: [first] }], ...actions(), onFoldChange: vi.fn() }
  const view = render(<StepTree {...props} foldedSteps={[]} />, { wrapper })
  fireEvent.click(screen.getByRole('button', { name: /desktopWorkflow.condition/ }))
  expect(props.onFoldChange).toHaveBeenCalledWith(['condition'])
  view.unmount()
  render(<StepTree {...props} foldedSteps={['condition']} />, { wrapper })
  expect(screen.getByRole('button', { name: /desktopWorkflow.condition/ })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: /第一个动作/ })).not.toBeInTheDocument()
})
