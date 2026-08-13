import { useEffect, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FilesWorkspaceRuntimeProvider } from '#widgets/files-workspace'
import {
  useFilesWorkspaceRuntime,
  type FilesWorkspaceRuntimeValue,
} from '../widgets/files-workspace/model/useFilesWorkspaceRuntime'

function RuntimeProbe({ onRuntime }: { onRuntime: (runtime: FilesWorkspaceRuntimeValue) => void }) {
  const runtime = useFilesWorkspaceRuntime()

  useEffect(() => {
    onRuntime(runtime)
  }, [onRuntime, runtime])

  return <output data-testid="files-runtime-probe">ready</output>
}

function RuntimeHarness({ children }: { children: (runtime: FilesWorkspaceRuntimeValue) => void }) {
  const [mounted, setMounted] = useState(true)

  return (
    <FilesWorkspaceRuntimeProvider>
      <button type="button" onClick={() => setMounted((current) => !current)}>
        toggle-probe
      </button>
      {mounted ? <RuntimeProbe onRuntime={children} /> : null}
    </FilesWorkspaceRuntimeProvider>
  )
}

describe('文件工作区运行时合同', () => {
  it('页面子树重新挂载后保留同一文件会话的目录状态', async () => {
    const user = userEvent.setup()
    let capturedRuntime: FilesWorkspaceRuntimeValue | null = null
    const getRuntime = () => {
      if (!capturedRuntime) {
        throw new Error('文件工作区运行时尚未就绪')
      }
      return capturedRuntime
    }

    render(<RuntimeHarness>{(value) => { capturedRuntime = value }}</RuntimeHarness>)

    await waitFor(() => expect(capturedRuntime).not.toBeNull())
    act(() => {
      getRuntime().updateSession('file-session-a', '/', (current) => ({
        ...current,
        committedPath: '/srv/project',
        scrollTop: 168,
      }))
    })
    await waitFor(() => {
      expect(getRuntime().states['file-session-a']?.committedPath).toBe('/srv/project')
    })

    await user.click(screen.getByRole('button', { name: 'toggle-probe' }))
    expect(screen.queryByTestId('files-runtime-probe')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'toggle-probe' }))
    expect(screen.getByTestId('files-runtime-probe')).toBeInTheDocument()
    expect(getRuntime().states['file-session-a']?.scrollTop).toBe(168)
  })

  it('恢复换 ID 时同步迁移目录、传输、脏路径和上传刷新目标', async () => {
    let capturedRuntime: FilesWorkspaceRuntimeValue | null = null
    const getRuntime = () => {
      if (!capturedRuntime) {
        throw new Error('文件工作区运行时尚未就绪')
      }
      return capturedRuntime
    }

    render(<RuntimeHarness>{(value) => { capturedRuntime = value }}</RuntimeHarness>)

    await waitFor(() => expect(capturedRuntime).not.toBeNull())
    act(() => {
      const runtime = getRuntime()
      runtime.updateSession('file-session-source', '/', (current) => ({
        ...current,
        committedPath: '/srv/project',
      }))
      runtime.startPendingTransferOperation({
        hostId: 'host-a',
        fileSessionId: 'file-session-source',
        title: '上传文件',
        progress: 20,
      })
      runtime.markDirectoryDirty('file-session-source', '/srv/project')
      runtime.trackUploadRefreshTask('upload-a', {
        fileSessionId: 'file-session-source',
        targetPath: '/srv/project',
      })
      runtime.adoptSession('file-session-source', 'file-session-target', '/')
    })

    await waitFor(() => {
      expect(getRuntime().states['file-session-source']).toBeUndefined()
      expect(getRuntime().states['file-session-target']?.committedPath).toBe('/srv/project')
      expect(getRuntime().pendingTransferOperations[0]?.fileSessionId).toBe('file-session-target')
    })
    expect(getRuntime().isDirectoryDirty('file-session-target', '/srv/project')).toBe(true)
    expect(getRuntime().consumeUploadRefreshTask('upload-a')).toEqual({
      fileSessionId: 'file-session-target',
      targetPath: '/srv/project',
    })
  })
})
