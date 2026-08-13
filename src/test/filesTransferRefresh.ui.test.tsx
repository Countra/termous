import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TransferTask } from '#entities/file'
import { FilesWorkspaceRuntimeProvider } from '#widgets/files-workspace'
import { useFilesTransferRefresh } from '../widgets/files-workspace/model/useFilesTransferRefresh'
import {
  useFilesWorkspaceRuntime,
  type FilesWorkspaceUploadRefreshTarget,
} from '../widgets/files-workspace/model/useFilesWorkspaceRuntime'

interface ActiveDirectory {
  fileSessionId: string
  path: string
  connected: boolean
}

function transferTask(
  id: string,
  type: TransferTask['type'],
  status: TransferTask['status'],
  patch: Partial<TransferTask> = {},
): TransferTask {
  return {
    id,
    host_id: 'host-a',
    file_session_id: 'file-session-a',
    type,
    status,
    source_paths: ['/source'],
    target_path: '/target',
    total_bytes: 100,
    transferred_bytes: status === 'completed' ? 100 : 0,
    remaining_bytes: status === 'completed' ? 0 : 100,
    total_files: 1,
    completed_files: status === 'completed' ? 1 : 0,
    progress_percent: status === 'completed' ? 100 : 0,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 0,
    elapsed_seconds: 0,
    cancellable: status === 'queued' || status === 'running',
    retryable: status === 'failed' || status === 'cancelled',
    overwrite_policy: 'ask',
    created_at: '2026-08-09T00:00:00.000Z',
    ...patch,
  }
}

function createRefreshHarness(events: string[] = []) {
  const uploadTargets = new Map<string, FilesWorkspaceUploadRefreshTarget>()
  const loadDirectory = vi.fn(async (path: string) => {
    events.push(`load:${path}`)
    return true
  })
  const trackWorkspaceUploadRefreshTask = vi.fn((
    taskId: string,
    target: FilesWorkspaceUploadRefreshTarget,
  ) => {
    uploadTargets.set(taskId, target)
  })
  const hasUploadRefreshTask = vi.fn((taskId: string) => uploadTargets.has(taskId))
  const consumeUploadRefreshTask = vi.fn((taskId: string) => {
    const target = uploadTargets.get(taskId) ?? null
    uploadTargets.delete(taskId)
    return target
  })
  const pruneUploadRefreshTasks = vi.fn((taskIds: ReadonlySet<string>) => {
    uploadTargets.forEach((_target, taskId) => {
      if (!taskIds.has(taskId)) {
        uploadTargets.delete(taskId)
      }
    })
  })
  const markDirectoryDirty = vi.fn((fileSessionId: string, path: string) => {
    events.push(`dirty:${fileSessionId}:${path}`)
  })

  return {
    consumeUploadRefreshTask,
    hasUploadRefreshTask,
    loadDirectory,
    markDirectoryDirty,
    pruneUploadRefreshTasks,
    trackWorkspaceUploadRefreshTask,
    uploadTargets,
  }
}

function renderRefreshHook(
  transfers: TransferTask[],
  activeDirectory: ActiveDirectory | null = {
    fileSessionId: 'file-session-a',
    path: '/target',
    connected: true,
  },
  harness = createRefreshHarness(),
) {
  return {
    ...renderHook(
      ({ currentTransfers, currentDirectory }) => useFilesTransferRefresh({
        transfers: currentTransfers,
        activeDirectory: currentDirectory,
        ...harness,
      }),
      {
        initialProps: {
          currentTransfers: transfers,
          currentDirectory: activeDirectory,
        },
      },
    ),
    harness,
  }
}

describe('文件传输刷新协调器合同', () => {
  it('上传完成先标记目录为脏，再静默刷新当前目录且只消费一次', () => {
    const events: string[] = []
    const harness = createRefreshHarness(events)
    const running = transferTask('upload-a', 'upload_file', 'running')
    const view = renderRefreshHook([running], undefined, harness)

    expect(harness.uploadTargets.get(running.id)).toEqual({
      fileSessionId: 'file-session-a',
      targetPath: '/target',
    })

    view.rerender({
      currentTransfers: [{ ...running, status: 'completed' }],
      currentDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: true,
      },
    })

    expect(events).toEqual([
      'dirty:file-session-a:/target',
      'load:/target',
    ])
    expect(harness.loadDirectory).toHaveBeenCalledWith('/target', {
      kind: 'refresh',
      quiet: true,
    })
    expect(harness.consumeUploadRefreshTask).toHaveBeenCalledTimes(1)

    view.rerender({
      currentTransfers: [{ ...running, status: 'completed' }],
      currentDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: true,
      },
    })
    expect(harness.consumeUploadRefreshTask).toHaveBeenCalledTimes(1)
    expect(harness.loadDirectory).toHaveBeenCalledTimes(1)
  })

  it('同一目录的多个上传完成只触发一次刷新', () => {
    const first = transferTask('upload-a', 'upload_file', 'running')
    const second = transferTask('upload-b', 'upload_directory', 'running')
    const view = renderRefreshHook([first, second])

    view.rerender({
      currentTransfers: [
        { ...first, status: 'completed' },
        { ...second, status: 'completed' },
      ],
      currentDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: true,
      },
    })

    expect(view.harness.markDirectoryDirty).toHaveBeenCalledTimes(1)
    expect(view.harness.loadDirectory).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: '后台目录',
      activeDirectory: {
        fileSessionId: 'file-session-b',
        path: '/target',
        connected: true,
      },
    },
    {
      name: '断开连接',
      activeDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: false,
      },
    },
  ])('$name的上传完成只标记目录为脏', ({ activeDirectory }) => {
    const running = transferTask('upload-a', 'upload_file', 'running')
    const view = renderRefreshHook([running], activeDirectory)

    view.rerender({
      currentTransfers: [{ ...running, status: 'completed' }],
      currentDirectory: activeDirectory,
    })

    expect(view.harness.markDirectoryDirty).toHaveBeenCalledWith(
      'file-session-a',
      '/target',
    )
    expect(view.harness.loadDirectory).not.toHaveBeenCalled()
  })

  it.each(['failed', 'cancelled'] as const)(
    '%s 上传会消费跟踪记录，但不会刷新目录',
    (status) => {
      const running = transferTask('upload-a', 'upload_file', 'running')
      const view = renderRefreshHook([running])

      view.rerender({
        currentTransfers: [{ ...running, status }],
        currentDirectory: {
          fileSessionId: 'file-session-a',
          path: '/target',
          connected: true,
        },
      })

      expect(view.harness.consumeUploadRefreshTask).toHaveBeenCalledWith(running.id)
      expect(view.harness.markDirectoryDirty).not.toHaveBeenCalled()
      expect(view.harness.loadDirectory).not.toHaveBeenCalled()
    },
  )

  it('下载跟踪保留 mappingId，并使用任务更新后的目标路径', () => {
    const running = transferTask('download-a', 'download_file', 'running', {
      target_path: 'C:\\downloads\\pending',
    })
    const view = renderRefreshHook([running])

    act(() => view.result.current.trackDownloadRefreshTask(running, 'mapping-a'))
    view.rerender({
      currentTransfers: [{
        ...running,
        target_path: 'C:\\downloads\\final',
      }],
      currentDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: true,
      },
    })
    view.rerender({
      currentTransfers: [{
        ...running,
        status: 'completed',
        target_path: 'C:\\downloads\\final',
      }],
      currentDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: true,
      },
    })

    expect(view.result.current.localRefreshRequests).toEqual([{
      id: running.id,
      mappingId: 'mapping-a',
      targetPath: 'C:\\downloads\\final',
    }])
  })

  it('下载完成只产生一次请求，失败、取消和历史终态任务不会产生请求', () => {
    const completed = transferTask('download-completed', 'download_file', 'running')
    const failed = transferTask('download-failed', 'download_file', 'running')
    const cancelled = transferTask('download-cancelled', 'download_file', 'running')
    const historical = transferTask('download-historical', 'download_file', 'completed')
    const view = renderRefreshHook([completed, failed, cancelled, historical])

    act(() => {
      view.result.current.trackDownloadRefreshTask(completed)
      view.result.current.trackDownloadRefreshTask(failed)
      view.result.current.trackDownloadRefreshTask(cancelled)
    })
    const terminalTransfers = [
      { ...completed, status: 'completed' as const },
      { ...failed, status: 'failed' as const },
      { ...cancelled, status: 'cancelled' as const },
      historical,
    ]
    view.rerender({
      currentTransfers: terminalTransfers,
      currentDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: true,
      },
    })
    expect(view.result.current.localRefreshRequests).toEqual([{
      id: completed.id,
      mappingId: undefined,
      targetPath: completed.target_path,
    }])

    view.rerender({
      currentTransfers: terminalTransfers,
      currentDirectory: {
        fileSessionId: 'file-session-a',
        path: '/target',
        connected: true,
      },
    })
    expect(view.result.current.localRefreshRequests).toHaveLength(1)
  })

  it('已经从任务列表消失的下载不会在重新出现后补发刷新', () => {
    const running = transferTask('download-a', 'download_file', 'running')
    const view = renderRefreshHook([running])
    act(() => view.result.current.trackDownloadRefreshTask(running))

    view.rerender({
      currentTransfers: [],
      currentDirectory: null,
    })
    view.rerender({
      currentTransfers: [{ ...running, status: 'completed' }],
      currentDirectory: null,
    })

    expect(view.result.current.localRefreshRequests).toEqual([])
  })

  it('本地刷新队列只保留最后五十条请求', () => {
    const running = Array.from({ length: 55 }, (_, index) => transferTask(
      `download-${index}`,
      'download_file',
      'running',
      { target_path: `C:\\downloads\\${index}` },
    ))
    const view = renderRefreshHook(running)
    act(() => {
      running.forEach((task) => view.result.current.trackDownloadRefreshTask(task))
    })

    view.rerender({
      currentTransfers: running.map((task) => ({ ...task, status: 'completed' })),
      currentDirectory: null,
    })

    expect(view.result.current.localRefreshRequests).toHaveLength(50)
    expect(view.result.current.localRefreshRequests[0]?.id).toBe('download-5')
    expect(view.result.current.localRefreshRequests[49]?.id).toBe('download-54')
  })
})

interface PersistentUploadProbeProps {
  transfers: TransferTask[]
  onRefresh: (targetPath: string) => void
}

function PersistentUploadProbe({ transfers, onRefresh }: PersistentUploadProbeProps) {
  const runtime = useFilesWorkspaceRuntime()
  useFilesTransferRefresh({
    transfers,
    activeDirectory: {
      fileSessionId: 'file-session-a',
      path: '/target',
      connected: true,
    },
    loadDirectory: async (path) => {
      onRefresh(path)
      return true
    },
    trackWorkspaceUploadRefreshTask: runtime.trackUploadRefreshTask,
    hasUploadRefreshTask: runtime.hasUploadRefreshTask,
    consumeUploadRefreshTask: runtime.consumeUploadRefreshTask,
    pruneUploadRefreshTasks: runtime.pruneUploadRefreshTasks,
    markDirectoryDirty: runtime.markDirectoryDirty,
  })
  return null
}

function PersistentUploadHarness({
  mounted,
  transfers,
  onRefresh,
}: PersistentUploadProbeProps & { mounted: boolean }) {
  return (
    <FilesWorkspaceRuntimeProvider>
      {mounted ? (
        <PersistentUploadProbe transfers={transfers} onRefresh={onRefresh} />
      ) : null}
    </FilesWorkspaceRuntimeProvider>
  )
}

it('页面重新挂载后可消费常驻运行时保留的上传刷新目标', () => {
  const onRefresh = vi.fn()
  const running = transferTask('upload-a', 'upload_file', 'running')
  const view = render(
    <PersistentUploadHarness
      mounted
      transfers={[running]}
      onRefresh={onRefresh}
    />,
  )

  view.rerender(
    <PersistentUploadHarness
      mounted={false}
      transfers={[{ ...running, status: 'completed' }]}
      onRefresh={onRefresh}
    />,
  )
  view.rerender(
    <PersistentUploadHarness
      mounted
      transfers={[{ ...running, status: 'completed' }]}
      onRefresh={onRefresh}
    />,
  )

  expect(onRefresh).toHaveBeenCalledWith('/target')
  expect(onRefresh).toHaveBeenCalledTimes(1)
})
