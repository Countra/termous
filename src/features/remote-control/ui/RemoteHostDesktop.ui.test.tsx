import { create } from '@bufbuild/protobuf'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { DesktopSourceSchema, DesktopTargetSchema } from '@termous/remote-protocol/desktop-protocol'
import type { RemoteClient } from '#entities/remote-control'
import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { RemoteHostDesktop } from './RemoteHostDesktop'

const fixture = vi.hoisted(() => ({ target: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }))
vi.mock('./RemoteDesktop', () => ({ RemoteDesktop: ({ target }: { target: unknown }) => { fixture.target(target); return <div>测试观看器</div> } }))
beforeEach(() => fixture.target.mockReset())

test('来源必须显式选择；切换种类释放旧观看，窗口标为只读', async () => {
  const request = vi.fn(async ({ sourceKind }: { sourceKind: string }) => ({ sources: [create(DesktopSourceSchema, {
    target: create(DesktopTargetSchema, { kind: 'host_desktop', instanceId: 'core', sourceId: sourceKind, sourceKind, sourceGeneration: 3n }),
    title: sourceKind === 'screen' ? '显示器 A' : '测试窗口', readOnly: sourceKind === 'window',
  })] }))
  render(<RemoteHostDesktop client={{ desktop: request } as unknown as RemoteClient} active />)
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'sources', sourceKind: 'screen', continuityVersion: 1 }))
  expect(fixture.target).not.toHaveBeenCalled()
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '画面来源' }))
  fireEvent.click(await screen.findByText('显示器 A'))
  expect(await screen.findByText('测试观看器')).toBeInTheDocument()
  expect(fixture.target.mock.lastCall?.[0]).toMatchObject({ instanceId: 'core', sourceGeneration: 3n })
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '来源类型' }))
  fireEvent.click(screen.getByText('窗口（只读）'))
  await waitFor(() => expect(request).toHaveBeenLastCalledWith({ action: 'sources', sourceKind: 'window', continuityVersion: 1 }))
  expect(screen.queryByText('测试观看器')).not.toBeInTheDocument()
  expect(screen.getByText('窗口仅供观看，无法控制。')).toBeInTheDocument()
})

test('缺少共享权限不会自动连接或选择来源', async () => {
  render(<RemoteHostDesktop client={{ desktop: vi.fn().mockRejectedValue(new Error('remote_forbidden')) } as unknown as RemoteClient} active />)
  expect(await screen.findByText('无法读取设备桌面，请确认被控端已允许共享。')).toBeInTheDocument()
  expect(fixture.target).not.toHaveBeenCalled()
})

test('Core 提供的备用名称原样显示，选择仍绑定来源身份', async () => {
  const request = vi.fn(async () => ({ sources: [
    create(DesktopSourceSchema, {
      target: create(DesktopTargetSchema, { kind: 'host_desktop', instanceId: 'core', sourceId: 'second', sourceKind: 'screen', sourceGeneration: 3n }),
      title: 'Display 12',
    }),
    create(DesktopSourceSchema, {
      target: create(DesktopTargetSchema, { kind: 'host_desktop', instanceId: 'core', sourceId: 'first', sourceKind: 'screen', sourceGeneration: 2n }),
      title: 'Display 7',
    }),
  ] }))
  render(<RemoteHostDesktop client={{ desktop: request } as unknown as RemoteClient} active />)
  await waitFor(() => expect(request).toHaveBeenCalled())
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '画面来源' }))
  expect(await screen.findByText('Display 7')).toBeInTheDocument()
  fireEvent.click(await screen.findByText('Display 12'))
  expect(await screen.findByText('测试观看器')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '设备桌面' })).getByTitle('Display 12')).toBeInTheDocument()
  expect(fixture.target.mock.lastCall?.[0]).toMatchObject({ sourceId: 'second', sourceGeneration: 3n })
})
