import { useState } from 'react'
import { App as AntdApp } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpClientToken } from '#entities/mcp-access'
import { McpTokenDialog } from './McpTokenDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const endpoint = 'http://127.0.0.1:49217/mcp'
const token = 'tmcp_client-1.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const result: McpClientToken = {
  client: {
    id: 'client-1',
    name: 'Codex',
    enabled: true,
    approval_bypass: false,
    scopes: ['hosts:read', 'sessions:read'],
    host_access_mode: 'all_saved',
    token_prefix: 'tmcp_client-1',
    revision: 1,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
  },
  token,
}
const expectedConfig = JSON.stringify({
  mcpServers: {
    termous: {
      type: 'http',
      url: endpoint,
      headers: { Authorization: `Bearer ${token}` },
    },
  },
}, null, 2)
const expectedCodexConfig = [
  '[mcp_servers.termous]',
  `url = '${endpoint}'`,
  'tool_timeout_sec = 180',
  `http_headers = { Authorization = 'Bearer ${token}' }`,
].join('\n')
const expectedCodexCommand = `powershell.exe -NoProfile -Command "${[
  "Set-Variable -Name h -Value ([Environment]::GetEnvironmentVariable('CODEX_HOME'))",
  "if ([string]::IsNullOrWhiteSpace((Get-Variable -Name h -ValueOnly))) { Set-Variable -Name h -Value ([IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.codex')) }",
  '[void][IO.Directory]::CreateDirectory((Get-Variable -Name h -ValueOnly))',
  'codex mcp remove termous',
  `if ((Get-Variable -Name LASTEXITCODE -ValueOnly) -eq 0) { @('', '[mcp_servers.termous]', 'url = ''${endpoint}''', 'tool_timeout_sec = 180', 'http_headers = { Authorization = ''Bearer ${token}'' }') | Add-Content -LiteralPath ([IO.Path]::Combine((Get-Variable -Name h -ValueOnly), 'config.toml')); codex mcp get termous }`,
].join('; ')}"`
const originalTermousDescriptor = Object.getOwnPropertyDescriptor(window, 'termous')
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  restoreProperty(window, 'termous', originalTermousDescriptor)
  restoreProperty(navigator, 'clipboard', originalClipboardDescriptor)
  vi.restoreAllMocks()
})

describe('McpTokenDialog', () => {
  it('精确复制令牌与完整配置，并分别显示成功反馈', async () => {
    const user = userEvent.setup()
    const bridgeWriteText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    const navigatorWriteText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    installClipboard(bridgeWriteText, navigatorWriteText)
    renderDialog()

    const copyToken = screen.getByRole('button', { name: 'settings.mcp.copyTokenLabel' })
    const copyConfig = screen.getByRole('button', { name: 'settings.mcp.copyConfigLabel' })
    await user.click(copyToken)
    await waitFor(() => expect(bridgeWriteText).toHaveBeenNthCalledWith(1, token))
    await waitFor(() => expect(copyToken).toHaveTextContent('settings.mcp.copied'))

    await user.click(copyConfig)
    await waitFor(() => expect(bridgeWriteText).toHaveBeenNthCalledWith(2, expectedConfig))
    expect(JSON.parse(bridgeWriteText.mock.calls[1]?.[0] ?? '{}')).toEqual(JSON.parse(expectedConfig))
    await waitFor(() => expect(copyConfig).toHaveTextContent('settings.mcp.copied'))
    expect(navigatorWriteText).not.toHaveBeenCalled()
  })

  it('默认提供跨平台 Codex 配置，并可切换复制 Windows 导入命令', async () => {
    const user = userEvent.setup()
    const bridgeWriteText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    const navigatorWriteText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    installClipboard(bridgeWriteText, navigatorWriteText)
    renderDialog()

    const configTab = screen.getByRole('tab', { name: 'settings.mcp.configFileTab' })
    const codexTab = screen.getByRole('tab', { name: 'settings.mcp.codexTab' })
    expect(configTab).toHaveAttribute('aria-selected', 'true')

    await user.click(codexTab)
    expect(codexTab).toHaveAttribute('aria-selected', 'true')
    const setupMethod = screen.getByRole('radiogroup', { name: 'settings.mcp.codexMethodLabel' })
    const manualMethod = screen.getByRole('radio', { name: 'settings.mcp.codexManualMethod' })
    const windowsMethod = screen.getByRole('radio', { name: 'settings.mcp.codexWindowsMethod' })
    expect(setupMethod).toBeInTheDocument()
    expect(manualMethod).toBeChecked()
    expect(windowsMethod).not.toBeChecked()
    expect(screen.getByText('settings.mcp.codexCrossPlatform')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.mcp.codexConfigCodeLabel').textContent).toBe(expectedCodexConfig)
    expect(expectedCodexConfig).not.toContain('type =')
    const copyCodexConfig = screen.getByRole('button', { name: 'settings.mcp.copyCodexConfigLabel' })
    await user.click(copyCodexConfig)
    await waitFor(() => expect(bridgeWriteText).toHaveBeenNthCalledWith(1, expectedCodexConfig))
    await waitFor(() => expect(copyCodexConfig).toHaveTextContent('settings.mcp.copied'))

    await user.click(screen.getByText('settings.mcp.codexWindowsMethod'))
    expect(windowsMethod).toBeChecked()
    expect(screen.getByText('settings.mcp.codexWindowsOnly')).toBeInTheDocument()
    const command = screen.getByLabelText('settings.mcp.codexCommandCodeLabel')
    expect(command.textContent).toBe(expectedCodexCommand)
    expect(expectedCodexCommand).toContain(token)
    expect(expectedCodexCommand).toContain(`Bearer ${token}`)
    expect(expectedCodexCommand).not.toContain('TERMOUS_MCP_TOKEN')
    expect(expectedCodexCommand).toMatch(/^powershell\.exe -NoProfile -Command /)
    const copyCodex = screen.getByRole('button', { name: 'settings.mcp.copyCodexCommandLabel' })
    expect(copyCodex).not.toHaveTextContent('settings.mcp.copied')
    await user.click(copyCodex)

    await waitFor(() => expect(bridgeWriteText).toHaveBeenNthCalledWith(2, expectedCodexCommand))
    await waitFor(() => expect(copyCodex).toHaveTextContent('settings.mcp.copied'))
    expect(navigatorWriteText).not.toHaveBeenCalled()
  })

  it('禁止通过关闭按钮、Escape 或遮罩绕过保存确认', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDialog(onClose)
    const dialog = screen.getByRole('dialog', { name: /settings\.mcp\.tokenTitle/ })

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    const wrap = dialog.closest('.ant-modal-wrap')
    expect(wrap).not.toBeNull()
    fireEvent.mouseDown(wrap as Element)
    fireEvent.mouseUp(wrap as Element)
    fireEvent.click(wrap as Element)
    expect(screen.getByText(token)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('确认保存时先同步清除 DOM 中的令牌，再于下一帧关闭', () => {
    const onClose = vi.fn()
    renderDialog(onClose)
    let closeFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      closeFrame = callback
      return 1
    })

    expect(document.body.textContent).toContain(token)
    expect(document.body.textContent).toContain(`Bearer ${token}`)
    fireEvent.click(screen.getByRole('tab', { name: 'settings.mcp.codexTab' }))
    expect(screen.getByRole('tabpanel', { name: 'settings.mcp.codexTab' }))
      .toHaveTextContent('http_headers')
    fireEvent.click(screen.getByRole('radio', { name: 'settings.mcp.codexWindowsMethod' }))
    expect(screen.getByLabelText('settings.mcp.codexCommandCodeLabel')).toHaveTextContent('powershell.exe')
    fireEvent.click(screen.getByRole('button', { name: 'settings.mcp.tokenSaved' }))

    expect(document.body.textContent).not.toContain(token)
    expect(document.body.textContent).not.toContain(`Bearer ${token}`)
    expect(onClose).not.toHaveBeenCalled()
    act(() => closeFrame?.(performance.now()))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('复制失败时保留令牌并允许重试，且不展示内部错误', async () => {
    const user = userEvent.setup()
    const bridgeWriteText = vi.fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('CLIPBOARD_INTERNAL_SENTINEL'))
      .mockResolvedValueOnce(undefined)
    const navigatorWriteText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    installClipboard(bridgeWriteText, navigatorWriteText)
    renderDialog()
    const copyToken = screen.getByRole('button', { name: 'settings.mcp.copyTokenLabel' })

    await user.click(copyToken)
    expect(await screen.findByText('settings.mcp.operationFailed')).toBeInTheDocument()
    expect(screen.getByText(token)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('CLIPBOARD_INTERNAL_SENTINEL')

    await user.click(copyToken)
    await waitFor(() => expect(bridgeWriteText).toHaveBeenNthCalledWith(2, token))
    await waitFor(() => expect(copyToken).toHaveTextContent('settings.mcp.copied'))
    expect(screen.getByText(token)).toBeInTheDocument()
  })
})

function renderDialog(onClose = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState<McpClientToken | null>(result)
    return (
      <AntdApp>
        <McpTokenDialog
          result={value}
          endpoint={endpoint}
          onClose={() => {
            onClose()
            setValue(null)
          }}
        />
      </AntdApp>
    )
  }
  return render(<Harness />)
}

function installClipboard(
  bridgeWriteText: (value: string) => Promise<void>,
  navigatorWriteText: (value: string) => Promise<void>,
) {
  Object.defineProperty(window, 'termous', {
    configurable: true,
    value: { clipboard: { writeText: bridgeWriteText } },
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: navigatorWriteText },
  })
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
    return
  }
  Reflect.deleteProperty(target, key)
}
