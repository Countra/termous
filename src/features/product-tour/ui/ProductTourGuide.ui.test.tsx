import { StrictMode, type ReactElement } from 'react'
import { ConfigProvider } from 'antd'
import { act, render as renderView, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { createProductTourProgress } from '../model/productTourProgress.ts'
import { PRODUCT_TOUR_VERSION } from '../model/productTourSteps.ts'
import { ProductTourGuide, type ProductTourGuideProps } from './ProductTourGuide.tsx'
import type { ProductTourControllerProps } from './ProductTourController.tsx'

const state = vi.hoisted(() => ({ props: null as ProductTourControllerProps | null }))
vi.mock('./ProductTourController.tsx', () => ({ ProductTourController: (props: ProductTourControllerProps) => { state.props = props; return <div data-testid="guide-session">{props.topic}</div> } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function render(element: ReactElement) {
  return renderView(element, { wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider> })
}

function props(legacy?: string): ProductTourGuideProps {
  const values = new Map(legacy ? [['termous.ui.productTour.completedVersion', legacy]] : [])
  return {
    ready: true, autoStartEligible: false, blocked: false, manualRequestKey: 0,
    onPrepareStep: vi.fn(), onBlocked: vi.fn(), onError: vi.fn(), onActiveChange: vi.fn(),
    progress: createProductTourProgress(() => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } })),
  }
}

beforeEach(() => { state.props = null })

it('专题完成后返回选择页，展示完成信息并可继续另一专题', async () => {
  const user = userEvent.setup()
  const value = props()
  render(<StrictMode><ProductTourGuide {...value} manualRequestKey={1} /></StrictMode>)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /productTour.topics\./ })).toHaveLength(9)
  await user.click(screen.getByRole('button', { name: /productTour.topics.automation.title/ }))
  await waitFor(() => expect(screen.getByTestId('guide-session')).toHaveTextContent('automation'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  act(() => {
    state.props?.onActiveChange?.(true)
    state.props?.completionStore?.writeCompletedVersion(PRODUCT_TOUR_VERSION)
    state.props?.onFinished?.('completed')
    state.props?.onActiveChange?.(false)
  })
  expect(value.progress!.shouldOfferBasics()).toBe(true)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('productTour.topicCompleted')
  expect(within(screen.getByRole('button', { name: /productTour.topics.automation.title/ })).getByText('productTour.completed')).toBeVisible()
  await user.click(screen.getByRole('button', { name: /productTour.topics.desktop.title/ }))
  await waitFor(() => expect(screen.getByTestId('guide-session')).toHaveTextContent('desktop'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(state.props?.completionStore).toBe(value.progress!.forTopic('desktop'))
  act(() => { state.props?.onFinished?.('skipped'); state.props?.onActiveChange?.(false) })
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(value.progress!.forTopic('desktop').readCompletedVersion()).toBeNull()
})

it('讲解中返回专题列表不标记完成', async () => {
  const value = props()
  const user = userEvent.setup()
  render(<ProductTourGuide {...value} manualRequestKey={1} />)
  await user.click(await screen.findByRole('button', { name: /productTour.topics.files.title/ }))
  await screen.findByTestId('guide-session')
  act(() => { state.props?.onFinished?.('skipped'); state.props?.onActiveChange?.(false) })
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  expect(value.progress!.forTopic('files').readCompletedVersion()).toBeNull()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('productTour.chooseTopic')).toBeVisible()
})

it('新用户自动进入简短基础导览，看过后不重复打扰', async () => {
  const value = props()
  const view = render(<StrictMode><ProductTourGuide {...value} autoStartEligible /></StrictMode>)
  expect(await screen.findByTestId('guide-session')).toHaveTextContent('basics')
  act(() => state.props?.onActiveChange?.(true))
  expect(value.progress!.shouldOfferBasics()).toBe(false)
  act(() => { state.props?.onFinished?.('closed'); state.props?.onActiveChange?.(false) })
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerender(<ProductTourGuide {...value} ready={false} autoStartEligible />)
  view.rerender(<ProductTourGuide {...value} autoStartEligible />)
  await act(async () => undefined)
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
})

it('自动基础导览完成后也回到选择页，关闭选择页后不再次自动启动', async () => {
  const value = props()
  const user = userEvent.setup()
  const view = render(<ProductTourGuide {...value} autoStartEligible />)
  await screen.findByTestId('guide-session')
  act(() => {
    state.props?.onActiveChange?.(true)
    state.props?.completionStore?.writeCompletedVersion(PRODUCT_TOUR_VERSION)
    state.props?.onFinished?.('completed')
    state.props?.onActiveChange?.(false)
  })
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(<ProductTourGuide {...value} autoStartEligible />)
  await act(async () => undefined)
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
})

it.each(['closed', 'not-started'] as const)('%s 退出而不弹回专题选择，也不记录完成', async (reason) => {
  const value = props()
  const user = userEvent.setup()
  const view = render(<ProductTourGuide {...value} manualRequestKey={1} />)
  await user.click(await screen.findByRole('button', { name: /productTour.topics.agent.title/ }))
  await screen.findByTestId('guide-session')
  act(() => { state.props?.onFinished?.(reason); state.props?.onActiveChange?.(false) })
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(value.progress!.forTopic('agent').readCompletedVersion()).toBeNull()
  view.rerender(<ProductTourGuide {...value} manualRequestKey={2} />)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('专题结束时遇到审批等阻塞，不弹出选择页争抢交互', async () => {
  const value = props()
  const user = userEvent.setup()
  const view = render(<ProductTourGuide {...value} manualRequestKey={1} />)
  await user.click(await screen.findByRole('button', { name: /productTour.topics.desktop.title/ }))
  await screen.findByTestId('guide-session')
  view.rerender(<ProductTourGuide {...value} manualRequestKey={1} blocked />)
  act(() => state.props?.onFinished?.('skipped'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
})

it('旧版记录不触发新版自动导览，仍可手动选择新专题', async () => {
  const value = props('4')
  const view = render(<ProductTourGuide {...value} autoStartEligible />)
  await act(async () => undefined)
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
  view.rerender(<ProductTourGuide {...value} autoStartEligible manualRequestKey={1} />)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
})

it('选择专题前出现阻塞时不启动引导', async () => {
  const user = userEvent.setup()
  const value = props()
  const view = render(<ProductTourGuide {...value} manualRequestKey={1} />)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  view.rerender(<ProductTourGuide {...value} manualRequestKey={1} blocked />)
  await user.click(screen.getByRole('button', { name: /productTour.topics.desktop.title/ }))
  await waitFor(() => expect(value.onBlocked).toHaveBeenCalledOnce())
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
})

it('应用失去就绪状态时关闭专题选择，恢复后不自动重开', async () => {
  const value = props()
  const view = render(<ProductTourGuide {...value} manualRequestKey={1} />)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  view.rerender(<ProductTourGuide {...value} manualRequestKey={1} ready={false} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(<ProductTourGuide {...value} manualRequestKey={1} />)
  await act(async () => undefined)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
})

it('应用失去就绪状态时释放专题会话，恢复后允许重新手动选择', async () => {
  const value = props()
  const user = userEvent.setup()
  const view = render(<ProductTourGuide {...value} manualRequestKey={1} />)
  await user.click(await screen.findByRole('button', { name: /productTour.topics.desktop.title/ }))
  await screen.findByTestId('guide-session')
  view.rerender(<ProductTourGuide {...value} manualRequestKey={1} ready={false} />)
  expect(screen.queryByTestId('guide-session')).not.toBeInTheDocument()
  expect(value.progress!.forTopic('desktop').readCompletedVersion()).toBeNull()
  view.rerender(<ProductTourGuide {...value} manualRequestKey={2} />)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
})
