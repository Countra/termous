import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { SessionSchema } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import type { RemoteClient, Session } from '#entities/remote-control'
import { remoteCopy } from '#features/remote-control'
import { RemoteSessionPanels } from './RemoteSessionPanels'

vi.mock('#features/remote-control', async () => ({
  ...await vi.importActual<typeof import('#features/remote-control')>('#features/remote-control'),
  RemoteTerminal: function Terminal({ session }: { session: Session }) {
    const [value, setValue] = useState('')
    return <input aria-label={`草稿-${session.id}`} value={value} onChange={event => setValue(event.target.value)} />
  },
  RemoteFiles: () => <div>远端文件</div>, RemoteDesktop: () => <div>远端桌面</div>,
  RemoteHostKey: () => null, RemoteFeedback: () => null,
}))

const copy = remoteCopy('zh-CN')
const tabs = ['one', 'two'].map(id => create(SessionSchema, { id, kind: 'ssh', state: 'connected', name: id }))

test('键盘切换复用标签导航，保留终端状态，关闭视图不触发切换', () => {
  const select = vi.fn(), close = vi.fn()
  const props = { connected: true, client: {} as RemoteClient, tabs, selected: 'one', copy, theme: 'dark' as const,
    name: (session: Session) => session.name, select, close, changed: vi.fn() }
  const view = render(<RemoteSessionPanels {...props} />)
  fireEvent.change(screen.getByLabelText('草稿-one'), { target: { value: '保留的输入' } })
  fireEvent.keyDown(screen.getByRole('tab', { name: /one/ }), { key: 'ArrowRight' })
  expect(select).toHaveBeenLastCalledWith('two')
  view.rerender(<RemoteSessionPanels {...props} selected="two" />)
  expect(screen.getByLabelText('草稿-one')).toHaveValue('保留的输入')
  const tab = screen.getByRole('tab', { name: /two/ })
  select.mockClear()
  fireEvent.click(within(tab.closest('[data-session-tab-root]') as HTMLElement).getByRole('button', { name: copy.closeView }))
  expect(close).toHaveBeenCalledWith('two')
  expect(select).not.toHaveBeenCalled()
})

test('跨类型并排显示保持两边内容，关闭并排后仅显示选中会话', () => {
  const files = create(SessionSchema, { id: 'files', kind: 'files', state: 'connected', name: 'files' })
  render(<RemoteSessionPanels client={{} as RemoteClient} tabs={[tabs[0]!, files]} selected="one" copy={copy} theme="dark"
    name={session => session.name} select={vi.fn()} close={vi.fn()} changed={vi.fn()} />)
  const split = screen.getByRole('button', { name: copy.split })
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  fireEvent.click(split)
  expect(screen.getAllByRole('tabpanel')).toHaveLength(2)
  expect(split).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(split)
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  expect(split).toHaveAttribute('aria-pressed', 'false')
})
