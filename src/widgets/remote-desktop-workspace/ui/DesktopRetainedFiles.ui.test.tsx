import { render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { expect, test, vi } from 'vitest'
import type { DesktopExchange } from '#entities/remote-desktop'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import type { useDesktopFiles } from '../model/useDesktopFiles'
import { DesktopRetainedFiles } from './DesktopRetainedFiles'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

test('进入待领取页面直接显示首条记录的真实文件，清理后自动显示下一条', async () => {
  const first: DesktopExchange = { id: 'first', kind: 'exchange', session_id: 'closed-session', resource_generation: 3, state: 'retained', name: '文件交换', created_at: '2026-10-11T12:00:00Z' }
  const second = { ...first, id: 'second', resource_generation: 5 }
  const entries = vi.fn<DesktopFilesGateway['entries']>().mockImplementation(async exchange => [{ path: '/资料.txt', name: `${exchange.id}资料.txt`, kind: 'file', size: 4, version: '1', modified_at: '' }])
  const api = { entries } as unknown as DesktopFilesGateway
  const operations = { retained: [first, second], tasks: [], busy: false } as unknown as ReturnType<typeof useDesktopFiles>
  const view = render(<App><DesktopRetainedFiles api={api} operations={operations} overwrite="rename" /></App>)
  expect(await screen.findByRole('button', { name: 'first资料.txt' })).toBeVisible()
  expect(entries).toHaveBeenCalledWith({ id: 'first', resource_generation: 3 }, '/', true, expect.any(AbortSignal))
  view.rerender(<App><DesktopRetainedFiles api={api} operations={{ ...operations, retained: [second] }} overwrite="rename" /></App>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'second资料.txt' })).toBeVisible())
  expect(screen.queryByRole('button', { name: 'first资料.txt' })).not.toBeInTheDocument()
})
