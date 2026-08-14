import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LocalGrantItem, RemoteFileEntry } from '#entities/file'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; size?: string }) => {
      const detail = options?.size ?? options?.count
      return detail === undefined ? key : `${key}:${detail}`
    },
  }),
}))

import {
  type UploadFileConflict,
  useUploadConflictDecision,
} from '../model/uploadConflict.ts'
import { UploadConflictDialog } from './UploadConflictDialog.tsx'

function conflict(index: number): UploadFileConflict {
  const incoming: LocalGrantItem = {
    id: `local-${index}`,
    name: `report-${index}.txt`,
    kind: 'file',
    size: index * 1024,
  }
  const existing: RemoteFileEntry = {
    name: incoming.name,
    path: `/srv/${incoming.name}`,
    kind: 'file',
    size: index * 2048,
    is_hidden: false,
  }
  return { incoming, existing }
}

describe('上传冲突确认弹窗', () => {
  it('最多预览四项并以保留两者作为默认选择', async () => {
    const onPolicyChange = vi.fn()
    const onContinue = vi.fn()
    const user = userEvent.setup()

    render(
      <UploadConflictDialog
        open
        conflicts={[1, 2, 3, 4, 5].map(conflict)}
        targetPath="/srv/releases"
        selectedPolicy="rename"
        onPolicyChange={onPolicyChange}
        onContinue={onContinue}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveAccessibleName('files.uploadConflict.title')
    expect(screen.getByRole('heading', { name: 'files.uploadConflict.title' })).toBeInTheDocument()
    expect(screen.getByTitle('/srv/releases')).toBeInTheDocument()
    expect(screen.getByText('report-4.txt')).toBeInTheDocument()
    expect(screen.queryByText('report-5.txt')).not.toBeInTheDocument()
    expect(screen.getByText('files.uploadConflict.more:1')).toBeInTheDocument()

    const keepBoth = screen.getByRole('radio', { name: /files.uploadConflict.keepBoth/ })
    const overwrite = screen.getByRole('radio', { name: /files.uploadConflict.overwrite/ })
    expect(keepBoth).toBeChecked()
    expect(overwrite).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'files.uploadConflict.continueRename' })).toBeInTheDocument()

    await user.click(overwrite)
    expect(onPolicyChange).toHaveBeenCalledWith('overwrite')
  })

  it('支持取消、继续和 Escape 键盘操作', async () => {
    const onCancel = vi.fn()
    const onContinue = vi.fn()
    const user = userEvent.setup()

    const view = render(
      <UploadConflictDialog
        open
        conflicts={[conflict(1)]}
        targetPath="/srv"
        selectedPolicy="overwrite"
        onPolicyChange={vi.fn()}
        onContinue={onContinue}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'files.uploadConflict.continueOverwrite' }))
    expect(onContinue).toHaveBeenCalledTimes(1)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'app.cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})

describe('上传冲突决策 Hook', () => {
  it('默认选择重命名并返回用户最终确认的策略', async () => {
    const { result } = renderHook(() => useUploadConflictDecision())
    let pending!: Promise<'rename' | 'overwrite' | null>

    act(() => {
      pending = result.current.requestPolicy({ conflicts: [conflict(1)], targetPath: '/srv' })
    })
    expect(result.current.dialogProps.open).toBe(true)
    expect(result.current.dialogProps.selectedPolicy).toBe('rename')

    act(() => result.current.dialogProps.onPolicyChange('overwrite'))
    expect(result.current.dialogProps.selectedPolicy).toBe('overwrite')
    act(() => result.current.dialogProps.onContinue())
    await expect(pending).resolves.toBe('overwrite')
    expect(result.current.dialogProps.open).toBe(false)

    await expect(result.current.requestPolicy({ conflicts: [], targetPath: '/srv' })).resolves.toBe('rename')
  })

  it('并发请求不替换当前弹窗且卸载时完成待决策请求', async () => {
    const hook = renderHook(() => useUploadConflictDecision())
    let first!: Promise<'rename' | 'overwrite' | null>
    let second!: Promise<'rename' | 'overwrite' | null>

    act(() => {
      first = hook.result.current.requestPolicy({ conflicts: [conflict(1)], targetPath: '/first' })
      second = hook.result.current.requestPolicy({ conflicts: [conflict(2)], targetPath: '/second' })
    })

    await expect(second).resolves.toBeNull()
    expect(hook.result.current.dialogProps.targetPath).toBe('/first')

    hook.unmount()
    await expect(first).resolves.toBeNull()
  })

  it('取消弹窗时返回空决策并关闭当前请求', async () => {
    const { result } = renderHook(() => useUploadConflictDecision())
    let pending!: Promise<'rename' | 'overwrite' | null>

    act(() => {
      pending = result.current.requestPolicy({ conflicts: [conflict(1)], targetPath: '/srv' })
    })
    expect(result.current.dialogProps.open).toBe(true)

    act(() => result.current.dialogProps.onCancel())

    await expect(pending).resolves.toBeNull()
    expect(result.current.dialogProps.open).toBe(false)

    act(() => {
      pending = result.current.requestPolicy({ conflicts: [conflict(2)], targetPath: '/next' })
    })
    act(() => result.current.cancelPending())

    await expect(pending).resolves.toBeNull()
    expect(result.current.dialogProps.open).toBe(false)
  })
})
