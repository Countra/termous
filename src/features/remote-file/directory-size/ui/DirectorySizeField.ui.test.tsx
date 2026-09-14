import { App as AntdApp } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteDirectorySize } from '#entities/file'
import type { DirectorySizeGateway } from '../controller/useDirectorySizeController.ts'
import { DirectorySizeResultCache } from '../model/DirectorySizeResultCache.ts'
import { DirectorySizeField } from './DirectorySizeField.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'files.directorySize.calculate': '计算',
      'files.directorySize.calculating': '正在计算',
      'files.directorySize.cancel': '取消计算',
      'files.directorySize.retry': '重试',
      'files.directorySize.recalculate': '重新计算目录总大小',
      'files.directorySize.failed': '计算失败',
      'files.directorySize.estimatedValue': `约 ${String(values?.value ?? '')}`,
      'files.directorySize.calculatedAt': `计算于 ${String(values?.time ?? '')}`,
      'files.connectionRequired': '需要文件连接',
    })[key] ?? key,
  }),
}))

const source = {
  fileSessionId: 'file-session-1',
  connectionGeneration: 3,
  path: '/srv/data',
  listingReadAt: '2026-09-14T09:59:00Z',
}

function directorySizeResult(
  patch: Partial<RemoteDirectorySize> = {},
): RemoteDirectorySize {
  return {
    file_session_id: source.fileSessionId,
    path: source.path,
    total_bytes: 1024,
    estimated: true,
    connection_generation: source.connectionGeneration,
    calculated_at: '2026-09-14T10:00:00Z',
    duration_ms: 12,
    ...patch,
  }
}

function renderField(api: DirectorySizeGateway, onError = vi.fn()) {
  return {
    onError,
    ...render(
      <AntdApp>
        <DirectorySizeField
          api={api}
          cache={new DirectorySizeResultCache()}
          source={source}
          enabled
          onError={onError}
        />
      </AntdApp>,
    ),
  }
}

describe('目录总大小详情字段', () => {
  it('区分估算值与精确值，并支持重新计算', async () => {
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn()
        .mockResolvedValueOnce(directorySizeResult())
        .mockResolvedValueOnce(directorySizeResult({ total_bytes: 2048, estimated: false })),
    }
    renderField(api)

    fireEvent.click(screen.getByRole('button', { name: '计算' }))
    expect(await screen.findByText('约 1.0 KB')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '重新计算目录总大小' }))
    expect(await screen.findByText('2.0 KB')).toBeVisible()
    expect(api.calculateFileSessionDirectorySize).toHaveBeenCalledTimes(2)
  })

  it('主动取消只中断本次请求且不报告失败', async () => {
    let requestSignal: AbortSignal | undefined
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn((_id, _input, signal) => {
        requestSignal = signal
        return new Promise<RemoteDirectorySize>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('cancelled'), { code: 'REQUEST_ABORTED' }))
          }, { once: true })
        })
      }),
    }
    const { onError } = renderField(api)

    fireEvent.click(screen.getByRole('button', { name: '计算' }))
    expect(screen.getByText('正在计算')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '取消计算' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '计算' })).toBeVisible())
    expect(requestSignal?.aborted).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('真实失败后提供重试并在成功时清除错误状态', async () => {
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn()
        .mockRejectedValueOnce(new Error('failed'))
        .mockResolvedValueOnce(directorySizeResult({ estimated: false })),
    }
    const { onError } = renderField(api)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '计算' }))
    })
    expect(await screen.findByText('计算失败')).toBeVisible()
    expect(onError).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('1.0 KB')).toBeVisible()
    expect(screen.queryByText('计算失败')).toBeNull()
  })
})
