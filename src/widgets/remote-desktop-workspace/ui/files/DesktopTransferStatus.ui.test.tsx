import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { TransferTask } from '#entities/file'
import { TransferRuntimeContext, type TransferRuntimeValue } from '#features/transfers'
import { summarizeDesktopTransfers } from '../../model/desktopTransferSummary'
import { DesktopTransferStatus } from './DesktopTransferStatus'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function task(patch: Partial<TransferTask> = {}): TransferTask {
  return {
    id: 'upload', desktop_session_id: 'desktop', type: 'upload_file', status: 'running',
    source_paths: ['/file.txt'], target_path: '/', total_bytes: 100, transferred_bytes: 40, remaining_bytes: 60,
    total_files: 1, completed_files: 0, progress_percent: 40, speed_bytes_per_sec: 1024,
    average_speed_bytes_per_sec: 8192, elapsed_seconds: 1, cancellable: true, retryable: false,
    overwrite_policy: 'rename', created_at: '', ...patch,
  }
}

function runtime(transfers: TransferTask[], connected = true): TransferRuntimeValue {
  return {
    transfers, activeTransfers: transfers.filter(task => ['queued', 'running'].includes(task.status)),
    connected, initialized: true, refresh: vi.fn(async () => {}), upsertTransfer: vi.fn(), removeTransfer: vi.fn(),
    remoteCopyRefreshVersion: 0, consumeRemoteCopyRefreshEvents: () => [],
  }
}

test('摘要只合并当前桌面的活动任务，按字节计算进度并分别累计实时双向速率', () => {
  const summary = summarizeDesktopTransfers([
    task(), task({ id: 'download', type: 'download_directory', total_bytes: 300, transferred_bytes: 180, speed_bytes_per_sec: 2048 }),
    task({ status: 'completed' }), task({ status: 'failed' }), task({ status: 'cancelled' }),
    task({ desktop_session_id: 'other' }), task({ desktop_session_id: undefined }),
  ], 'desktop')
  expect(summary).toMatchObject({ count: 2, runningCount: 2, progress: 55, uploadRate: 1024, downloadRate: 2048 })
})

test.each([
  { phase: 'scanning' as const }, { total_bytes: 0 }, { total_bytes: NaN },
])('总量未知或扫描中时不展示虚构百分比：%o', patch => {
  expect(summarizeDesktopTransfers([task(), task(patch)], 'desktop').progress).toBeNull()
})

test('排队不累计速率，非法数值归零，瞬时停滞不使用平均速率替代', () => {
  const summary = summarizeDesktopTransfers([
    task({ speed_bytes_per_sec: 0 }), task({ speed_bytes_per_sec: NaN }), task({ speed_bytes_per_sec: -1, transferred_bytes: -1 }),
    task({ status: 'queued', speed_bytes_per_sec: 99999 }),
    task({ type: 'download_file', speed_bytes_per_sec: Infinity, transferred_bytes: 9999 }),
  ], 'desktop')
  expect(summary).toMatchObject({ count: 5, runningCount: 4, uploadRate: 0, downloadRate: 0, progress: 44 })
})

test('活动传输即时显示进度和速率，完成后恢复简洁入口且点击打开任务面板', () => {
  const onOpen = vi.fn()
  const tree = (transfers: TransferTask[]) => <TransferRuntimeContext.Provider value={runtime(transfers)}>
    <DesktopTransferStatus sessionId="desktop" onOpen={onOpen} />
  </TransferRuntimeContext.Provider>
  const view = render(tree([task()]))
  const button = screen.getByRole('button', { name: 'remoteDesktop.files.transferStatus.open' })
  expect(button).toHaveTextContent('40%')
  expect(button).toHaveTextContent('1.0 KiB/s')
  expect(within(button).queryByLabelText('remoteDesktop.files.transferStatus.download')).not.toBeInTheDocument()
  fireEvent.click(button)
  expect(onOpen).toHaveBeenCalledOnce()
  view.rerender(tree([task({ transferred_bytes: 80, speed_bytes_per_sec: 2048 })]))
  expect(button).toHaveTextContent('80%')
  expect(button).toHaveTextContent('2.0 KiB/s')
  view.rerender(tree([task({ status: 'completed' })]))
  expect(button).not.toHaveTextContent(/%|\/s/)
  expect(button).toHaveTextContent('remoteDesktop.files.title')
})

test('断流隐藏旧速率和百分比，恢复事件流后重新显示', () => {
  const tree = (connected: boolean) => <TransferRuntimeContext.Provider value={runtime([task()], connected)}>
    <DesktopTransferStatus sessionId="desktop" onOpen={vi.fn()} />
  </TransferRuntimeContext.Provider>
  const view = render(tree(false))
  const button = screen.getByRole('button')
  expect(button).toHaveTextContent('remoteDesktop.files.transferStatus.syncing')
  expect(button).not.toHaveTextContent(/%|\/s/)
  view.rerender(tree(true))
  expect(button).toHaveTextContent('40%')
  expect(button).toHaveTextContent('1.0 KiB/s')
})

test('仅排队时显示等待，没有速率；切到其他会话后不残留任务信息', () => {
  const tree = (sessionId: string) => <TransferRuntimeContext.Provider value={runtime([task({ status: 'queued' })])}>
    <DesktopTransferStatus sessionId={sessionId} onOpen={vi.fn()} />
  </TransferRuntimeContext.Provider>
  const view = render(tree('desktop'))
  expect(screen.getByRole('button')).toHaveTextContent('remoteDesktop.files.transferStatus.queued')
  expect(screen.getByRole('button')).not.toHaveTextContent(/\/s/)
  view.rerender(tree('other'))
  expect(screen.getByRole('button')).not.toHaveTextContent(/queued|%|\/s/)
})
