import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CoreFatalEvent, TermousBridge } from '#common/contracts'
import { i18n } from '#shared/i18n'
import { CoreFatalDialog } from './CoreFatalDialog'

const originalBridge = Object.getOwnPropertyDescriptor(window, 'termous')
const getComputedStyle = window.getComputedStyle.bind(window)
const failure: CoreFatalEvent = {
  title: '内部标题', code: 'DB_MIGRATION_FAILED',
  message: '执行第 31 版迁移失败：磁盘空间不足。',
  details: '最后确认版本：30\n目标版本：37',
}

beforeEach(() => {
  // JSDOM 不实现伪元素计算样式，组件的滚动条检测仍使用真实元素样式。
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
})

afterEach(() => {
  if (originalBridge) Object.defineProperty(window, 'termous', originalBridge)
  else Reflect.deleteProperty(window, 'termous')
  vi.restoreAllMocks()
})

function installBridge(options: {
  copy?: () => Promise<boolean>
  logs?: () => Promise<{ ok: boolean }>
  close?: () => Promise<boolean>
  diagnostics?: boolean
} = {}) {
  const copy = vi.fn(options.copy ?? (async () => true))
  const logs = vi.fn(options.logs ?? (async () => ({ ok: true })))
  const close = vi.fn(options.close ?? (async () => true))
  const writeText = vi.fn(async () => true)
  const bridge: TermousBridge = {
    platform: 'win32', getConfig: async () => ({}),
    getBuildInfo: async () => ({ product_name: 'Termous', version: '0.0.0-dev', core_version: null,
      platform: 'win32', arch: 'x64', packaged: false, update_supported: false, update_support_reason: 'development' }),
    ...(options.diagnostics === false ? {} : { diagnostics: { copyStartupDiagnostics: copy, openLogsDirectory: logs } }),
    clipboard: { writeText, readText: async () => '' },
    windowControls: {
      minimize: async () => true, toggleMaximize: async () => true, requestClose: async () => true,
      minimizeToTray: async () => true, confirmClose: close, isMaximized: async () => false,
      onMaximizeState: () => () => undefined, onCloseRequest: () => () => undefined,
    },
  }
  Object.defineProperty(window, 'termous', { configurable: true, value: bridge })
  return { copy, logs, close, writeText }
}

async function renderDialog(fatal: CoreFatalEvent | null = failure, language = 'zh-CN') {
  const localized = i18n.cloneInstance({ lng: language })
  await localized.changeLanguage(language)
  const element = (value: CoreFatalEvent | null) => (
    <ConfigProvider theme={{ token: { motion: false } }}>
      <I18nextProvider i18n={localized}><CoreFatalDialog fatal={value} /></I18nextProvider>
    </ConfigProvider>
  )
  const view = render(element(fatal))
  return { ...view, localized, element }
}

test('显示具体迁移原因及技术详情，标题和操作随语言切换', async () => {
  installBridge()
  const view = await renderDialog()
  expect(screen.getByRole('heading', { name: '数据库无法完成启动准备' })).toBeInTheDocument()
  expect(screen.getByText(failure.message)).toBeInTheDocument()
  fireEvent.click(screen.getByText('查看错误详情'))
  expect(screen.getByText(/最后确认版本：30/)).toHaveTextContent('DB_MIGRATION_FAILED')
  await act(async () => { await view.localized.changeLanguage('en-US') })
  expect(screen.getByRole('heading', { name: 'Database preparation failed' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeInTheDocument()
  expect(screen.getByText(failure.message)).toBeInTheDocument()
})

test('长错误和 HTML 内容按纯文本完整展示，不生成节点或执行代码', async () => {
  installBridge()
  const message = `<img src=x onerror="alert(1)">${'迁移失败；'.repeat(300)}`
  const details = '<script>window.untrusted = true</script>\n**原始错误**'
  await renderDialog({ ...failure, message, details })
  expect(screen.getByText(message).textContent).toBe(message)
  fireEvent.click(screen.getByText('查看错误详情'))
  expect(screen.getByText(/window.untrusted/).textContent).toContain(details)
  expect(document.querySelector('.ant-modal-body img')).toBeNull()
  expect(document.querySelector('.ant-modal-body script')).toBeNull()
  expect(screen.getByRole('button', { name: '退出软件' })).toBeEnabled()
})

test.each(['result', 'rejection'])('复制失败（%s）反馈明确且可以重试', async (mode) => {
  const bridge = installBridge({ copy: async () => {
    if (mode === 'rejection') throw new Error('clipboard unavailable')
    return false
  } })
  await renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '复制诊断' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('操作未能完成，请重试。'))
  const retryCopy = await screen.findByRole('button', { name: '复制诊断' })
  expect(retryCopy).toBeEnabled()
  expect(screen.getByRole('button', { name: '退出软件' })).toBeEnabled()
  bridge.copy.mockResolvedValueOnce(true)
  fireEvent.click(retryCopy)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('诊断信息已复制'))
})

test('诊断复制未结束时退出仍可用，并独立调用应用退出接口', async () => {
  let resolveCopy!: (value: boolean) => void
  const bridge = installBridge({ copy: () => new Promise((resolve) => { resolveCopy = resolve }) })
  await renderDialog()
  const copyButton = screen.getByRole('button', { name: '复制诊断' })
  fireEvent.click(copyButton)
  expect(copyButton).toBeDisabled()
  expect(screen.getByRole('button', { name: '打开日志' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '退出软件' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '退出软件' }))
  expect(bridge.close).toHaveBeenCalledTimes(1)
  await act(async () => resolveCopy(true))
})

test('打开日志只调用受限日志入口，失败时反馈并恢复按钮', async () => {
  const bridge = installBridge()
  await renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '打开日志' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '打开日志' })).toBeEnabled())
  expect(bridge.logs).toHaveBeenCalledWith()
  expect(bridge.copy).not.toHaveBeenCalled()
  bridge.logs.mockResolvedValueOnce({ ok: false })
  fireEvent.click(screen.getByRole('button', { name: '打开日志' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('操作未能完成，请重试。'))
})

test('没有诊断桥接时保留纯文本复制且隐藏不可用的日志入口', async () => {
  const bridge = installBridge({ diagnostics: false })
  await renderDialog({ ...failure, code: 'LOCAL_API_UNAVAILABLE' }, 'en-US')
  expect(screen.getByRole('heading', { name: 'Core connection error' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open logs' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
  await waitFor(() => expect(bridge.writeText).toHaveBeenCalledWith(
    ['LOCAL_API_UNAVAILABLE', failure.message, failure.details].join('\n'),
  ))
})

test('退出请求失败不会形成未处理拒绝，用户可以再次操作', async () => {
  const bridge = installBridge({ close: async () => { throw new Error('exit unavailable') } })
  await renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '退出软件' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('操作未能完成，请重试。'))
  expect(bridge.close).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '退出软件' })).toBeEnabled()
})

test('没有致命错误时不显示阻断对话框', async () => {
  installBridge()
  await renderDialog(null)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
