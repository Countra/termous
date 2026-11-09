import { fireEvent, render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AgentSessionSidebar, type AgentSessionSidebarProps } from './AgentSessionSidebar.tsx'

const rowRender = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./AgentSessionRow.tsx', () => ({ AgentSessionRow: ({ session, onSelect }: {
  session: { id: string }; onSelect: (id: string) => void
}) => { rowRender(); return <button onClick={() => onSelect(session.id)}>{session.id}</button> } }))

it('输入草稿仅更新回调闭包时不重绘会话列表，点击仍使用最新处理器', () => {
  const first = vi.fn(), latest = vi.fn()
  const props: AgentSessionSidebarProps = {
    sessions: Array.from({ length: 80 }, (_, i) => ({ id: `session-${i}`, title: `会话 ${i}`, model_id: 'model',
      model_name: 'Model', updated_at: '', archived: false, run_status: 'idle' })), disabled: false,
    onCreate: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onSelect: first,
  }
  const view = render(<AgentSessionSidebar {...props} />)
  const initial = rowRender.mock.calls.length
  for (let i = 0; i < 20; i++) view.rerender(<AgentSessionSidebar {...props} onSelect={id => latest(id)} />)
  expect(rowRender).toHaveBeenCalledTimes(initial)
  fireEvent.click(view.getByRole('button', { name: 'session-0' }))
  expect(latest).toHaveBeenCalledExactlyOnceWith('session-0')
  expect(first).not.toHaveBeenCalled()
  view.rerender(<AgentSessionSidebar {...props} disabled />)
  expect(rowRender.mock.calls.length).toBeGreaterThan(initial)
})
