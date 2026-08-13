import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrandVersionControl,
  UpdateRuntimeContext,
  type UpdateRuntimeValue,
} from '#features/update'

const testState = vi.hoisted(() => ({
  notificationError: vi.fn(),
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      notification: { error: testState.notificationError },
    }),
  },
  Button: ({
    children,
    className,
    onClick,
    ...props
  }: {
    'aria-busy'?: boolean
    'aria-label'?: string
    'data-update-status'?: string
    children?: ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <button className={className} onClick={onClick} type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'zh-CN' },
    t: (key: string, options?: { defaultValue?: string }) => (
      options?.defaultValue ?? key
    ),
  }),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function runtime(openUpdateWindow: () => Promise<boolean>): UpdateRuntimeValue {
  return {
    bridgeAvailable: true,
    initialized: true,
    initializationFailed: false,
    runtimeGeneration: 0,
    snapshot: null,
    setUpdatePreferences: async () => null,
    openUpdateWindow,
    retryInitialization: async () => true,
  }
}

function renderControl(openUpdateWindow: () => Promise<boolean>) {
  return render(
    <UpdateRuntimeContext.Provider value={runtime(openUpdateWindow)}>
      <BrandVersionControl appVersion="1.2.3" collapsed={false} />
    </UpdateRuntimeContext.Provider>,
  )
}

describe('品牌版本更新入口合同', () => {
  beforeEach(() => {
    testState.notificationError.mockClear()
  })

  it('打开请求未结束时拒绝重复触发并正确恢复忙碌状态', async () => {
    const opening = deferred<boolean>()
    const openUpdateWindow = vi.fn(() => opening.promise)
    renderControl(openUpdateWindow)
    const button = screen.getByRole('button', { name: '关于 Termous' })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(openUpdateWindow).toHaveBeenCalledTimes(1)
    expect(button).toHaveAttribute('aria-busy', 'true')

    opening.resolve(true)
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'false')
    })
  })

  it('窗口未打开时沿用现有错误反馈', async () => {
    const openUpdateWindow = vi.fn(async () => false)
    renderControl(openUpdateWindow)

    fireEvent.click(screen.getByRole('button', { name: '关于 Termous' }))

    await waitFor(() => {
      expect(testState.notificationError).toHaveBeenCalledTimes(1)
    })
  })
})
