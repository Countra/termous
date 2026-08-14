import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowControls } from '#app/app-shell'

const testState = vi.hoisted(() => ({
  confirmClose: vi.fn<() => Promise<void>>(),
}))

vi.mock('#shared/bridge', () => ({
  getTermousBridge: () => ({
    windowControls: {
      confirmClose: testState.confirmClose,
      isMaximized: async () => false,
      minimize: async () => undefined,
      minimizeToTray: async () => true,
      onCloseRequest: () => () => undefined,
      onMaximizeState: () => () => undefined,
      toggleMaximize: async () => false,
    },
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('antd', () => ({
  Button: ({
    children,
    danger: _danger,
    icon,
    loading = false,
    type: _buttonStyle,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    danger?: boolean
    icon?: ReactNode
    loading?: boolean
  }) => {
    void _danger
    void _buttonStyle
    return (
      <button
        {...props}
        type="button"
        aria-busy={loading}
        disabled={props.disabled || loading}
      >
        {icon}
        {children}
      </button>
    )
  },
  Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) => (
    open ? <div role="dialog">{children}</div> : null
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('窗口关闭确认', () => {
  beforeEach(() => {
    testState.confirmClose.mockReset()
  })

  it('Core 关闭完成前保持忙碌并拒绝重复提交', async () => {
    const shutdown = deferred()
    const onBeforeClose = vi.fn(() => shutdown.promise)
    testState.confirmClose.mockResolvedValue(undefined)
    render(<WindowControls closeBehavior="exit" onBeforeClose={onBeforeClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
    const confirmButton = screen.getByRole('button', { name: 'app.exitAndDisconnect' })

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(onBeforeClose).toHaveBeenCalledTimes(1)
      expect(testState.confirmClose).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(confirmButton).toHaveAttribute('aria-busy', 'true')
      expect(confirmButton).toBeDisabled()
    })

    await act(async () => {
      shutdown.resolve()
      await shutdown.promise
    })

    await waitFor(() => {
      expect(testState.confirmClose).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
