import { fireEvent, render as renderApp, screen, waitFor, within } from '@testing-library/react'
import { Button, ConfigProvider } from 'antd'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import { renderWithFeedback as render } from '../../test/renderWithFeedback'
import { FeedbackMessage, FeedbackMessageScope } from './FeedbackMessage'
import { TermousUiProvider } from '../../app/ui-runtime/TermousUiProvider'

beforeAll(async () => { await changeLanguage('zh-CN') })

test('错误放入主题消息层，页面保留原表单和布局', async () => {
  const { container } = render(<section aria-label="个人资料"><input aria-label="昵称" defaultValue="合成昵称" /><FeedbackMessage type="error" title="保存失败" /></section>)
  const message = await screen.findByRole('alert')
  expect(message).toHaveTextContent('保存失败')
  expect(message.closest('.ant-notification-bottomRight')).toBeInTheDocument()
  expect(container).not.toContainElement(message)
  expect(screen.getByRole('region', { name: '个人资料' })).not.toContainElement(message)
  expect(screen.getByLabelText('昵称')).toHaveValue('合成昵称')
})

test('同一错误只保留一条消息，任一捕获者卸载不会移除其他捕获者的消息', async () => {
  const view = (details: boolean) => <><FeedbackMessage type="warning" title="保存失败" />{details ? <FeedbackMessage type="error" title="保存失败" description="错误代码：local_failed" /> : null}</>
  const { rerender } = render(view(true))
  expect(await screen.findAllByText('保存失败')).toHaveLength(1)
  expect(screen.getByRole('alert')).toHaveTextContent('错误代码：local_failed')
  rerender(view(false))
  await waitFor(() => expect(screen.getByRole('alert')).not.toHaveTextContent('错误代码：local_failed'))
  expect(screen.getAllByText('保存失败')).toHaveLength(1)
})

test('关闭消息不会清除业务失败，也不会在普通重绘时重新出现', async () => {
  const retry = vi.fn()
  const view = () => <><input aria-label="昵称" defaultValue="保留草稿" /><FeedbackMessage type="warning" title="保存失败" action={<Button onClick={retry}>重试</Button>} /></>
  const { rerender } = render(view())
  const notice = await screen.findByRole('alert')
  fireEvent.click(within(notice).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  rerender(view())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText('昵称')).toHaveValue('保留草稿')
  expect(retry).not.toHaveBeenCalled()
})

test('真实主题运行时普通重绘与切换主题后，已关闭的消息不重新出现', async () => {
  const view = (revision: number, theme: 'dark' | 'light') => <TermousUiProvider language="zh-CN" theme={theme}><span>页面版本 {revision}</span><FeedbackMessage type="warning" title="保留的业务失败" /></TermousUiProvider>
  // JSDOM 不执行退出动画，仅关闭动效；通知接口仍由正式主题运行时创建。
  const { rerender } = renderApp(view(1, 'dark'), { wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider> })
  fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  rerender(view(2, 'dark'))
  expect(screen.getByText('页面版本 2')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  rerender(view(3, 'light'))
  expect(screen.getByText('页面版本 3')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('重试入口更新禁用状态，错误解除后撤下消息，下一次失败仍可提示', async () => {
  const retry = vi.fn()
  const view = (failed: boolean, busy: boolean) => failed ? <FeedbackMessage type="error" title="读取失败" action={<Button disabled={busy} onClick={retry}>重试</Button>} /> : null
  const { rerender } = render(view(true, false))
  fireEvent.click(await screen.findByRole('button', { name: /重\s*试/ }))
  expect(retry).toHaveBeenCalledOnce()
  rerender(view(true, true))
  await waitFor(() => expect(screen.getByRole('button', { name: /重\s*试/ })).toBeDisabled())
  rerender(view(false, false))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  rerender(view(true, false))
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败')
})

test('隐藏弹窗不发消息，关闭弹窗或切换账号时移除旧消息', async () => {
  const view = (active: boolean, scope: string, title: string) => <FeedbackMessageScope scope={scope}><FeedbackMessageScope active={active}><FeedbackMessage type="warning" title={title} /></FeedbackMessageScope></FeedbackMessageScope>
  const { rerender } = render(view(false, '账号甲', '旧账号错误'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  rerender(view(true, '账号甲', '旧账号错误'))
  expect(await screen.findByRole('alert')).toHaveTextContent('旧账号错误')
  rerender(view(false, '账号甲', '旧账号错误'))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  rerender(view(true, '账号乙', '新账号错误'))
  expect(await screen.findByRole('alert')).toHaveTextContent('新账号错误')
  expect(screen.queryByText('旧账号错误')).not.toBeInTheDocument()
})

test('不同账号的相同文案分别归属，隐藏父页面时子弹窗也不发消息', async () => {
  const { rerender } = render(<><FeedbackMessageScope scope="账号甲"><FeedbackMessage type="error" title="读取失败" /></FeedbackMessageScope><FeedbackMessageScope scope="账号乙"><FeedbackMessage type="error" title="读取失败" /></FeedbackMessageScope></>)
  expect(await screen.findAllByText('读取失败')).toHaveLength(2)
  rerender(<FeedbackMessageScope active={false}><FeedbackMessageScope active><FeedbackMessage type="error" title="读取失败" /></FeedbackMessageScope></FeedbackMessageScope>)
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})
