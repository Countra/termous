import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type ReactNode, type Ref } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import { RemoteDesktopPage } from './RemoteDesktopPage'

const runtime = vi.hoisted(() => ({
  sessions: [{ id: 'desktop', automation_host_id: 'host', connection_generation: 3 }],
  activeSessionId: 'desktop',
  selectSession: vi.fn(),
  automation: { show: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('#features/remote-desktop', () => ({ useRemoteDesktopRuntime: () => runtime }))
vi.mock('#widgets/remote-desktop-workspace', () => ({
  RemoteDesktopWorkspace: ({ tools, toolsButtonRef }: { tools?: Array<{ label: string; onClick: () => void }>; toolsButtonRef?: Ref<HTMLButtonElement> }) => <section><input aria-label="桌面会话状态" defaultValue="已连接" /><header><button ref={toolsButtonRef}>桌面工具</button>{tools?.map((tool) => <button key={tool.label} onClick={tool.onClick}>{tool.label}</button>)}</header></section>,
}))
vi.mock('#features/desktop-workflows', () => ({
  WorkflowWorkspace: ({ onViewDesktop, headerActions }: { onViewDesktop: (id: string) => Promise<void>; headerActions?: ReactNode }) => {
    const [name, setName] = useState('')
    return <><header>{headerActions}</header><input aria-label="流程草稿" value={name} onChange={(event) => setName(event.target.value)} /><button onClick={() => void onViewDesktop('desktop')}>查看目标桌面</button></>
  },
}))

beforeEach(() => { vi.clearAllMocks() })

it('自动化归属桌面工具，头部返回后保留会话、草稿并转移键盘焦点', () => {
  render(<RemoteDesktopPage workflow={{} as WorkflowGateway} profiles={[]} onDirtyChange={() => undefined} />)
  const workflow = screen.getByRole('button', { name: 'desktopWorkflow.workflow' })
  const tools = screen.getByRole('button', { name: '桌面工具' })
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('流程草稿')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('桌面会话状态'), { target: { value: '持续连接' } })
  fireEvent.click(workflow)
  const automation = screen.getByRole('region', { name: 'desktopWorkflow.workflow' })
  expect(automation).toHaveFocus()
  fireEvent.change(screen.getByLabelText('流程草稿'), { target: { value: '未保存流程' } })
  const back = within(automation).getByRole('button', { name: 'desktopWorkflow.backToDesktop' })
  expect(back.closest('header')).not.toBeNull()
  fireEvent.click(back)
  expect(tools).toHaveFocus()
  expect(screen.getByLabelText('桌面会话状态')).toHaveValue('持续连接')
  expect(screen.getByLabelText('流程草稿')).not.toBeVisible()
  expect(screen.getByLabelText('流程草稿').closest('[hidden]')).toHaveAttribute('inert')
  fireEvent.click(workflow)
  expect(screen.getByLabelText('流程草稿')).toHaveValue('未保存流程')
  expect(automation).toHaveFocus()
})

it('从自动化查看桌面时先唤起自动化宿主，再选择原会话', async () => {
  render(<RemoteDesktopPage workflow={{} as WorkflowGateway} profiles={[]} onDirtyChange={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.workflow' }))
  fireEvent.click(screen.getByRole('button', { name: '查看目标桌面' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'desktopWorkflow.workflow' })).toBeVisible())
  expect(runtime.automation.show).toHaveBeenCalledWith('desktop', 3, 'host')
  expect(runtime.selectSession).toHaveBeenCalledWith('desktop')
  expect(runtime.automation.show.mock.invocationCallOrder[0]).toBeLessThan(runtime.selectSession.mock.invocationCallOrder[0]!)
  expect(screen.getByLabelText('桌面会话状态')).toBeVisible()
})
