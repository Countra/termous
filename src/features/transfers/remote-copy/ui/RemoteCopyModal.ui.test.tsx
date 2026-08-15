import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FileSession,
  RemoteDirectoryListing,
  RemoteFileEntry,
  TransferTask,
} from '#entities/file'
import type { Host } from '#entities/host'
import { TermousApiError } from '#shared/api'
import type {
  RemoteCopyCreateRequest,
  RemoteCopyDirectoryRequest,
  RemoteCopyModalProps,
} from '../model/types.ts'
import { RemoteCopyModal } from './RemoteCopyModal.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (
      values?.id ? `${key}:${values.id}` : key
    ),
  }),
}))

function host(id: string, name: string): Host {
  return {
    id,
    name,
    platform: 'linux',
    group_id: '',
    address: `${id}.example.com`,
    port: 22,
    username: 'tester',
    auth_method: 'password',
    credential_id: 'credential',
    tags: [],
    favorite: false,
    fingerprint_policy: 'strict',
  }
}

function fileSession(
  id: string,
  hostId: string,
  generation = 1,
): FileSession {
  return {
    id,
    host_id: hostId,
    status: 'connected',
    current_path: `/home/${hostId}`,
    started_at: `2026-08-15T00:00:0${generation}Z`,
    connection_generation: generation,
  }
}

function entry(
  name: string,
  path: string,
  kind: RemoteFileEntry['kind'] = 'file',
): RemoteFileEntry {
  return {
    name,
    path,
    kind,
    size: 1,
    is_hidden: false,
  }
}

function listing(
  fileSessionId: string,
  path: string,
  entries: RemoteFileEntry[] = [],
): RemoteDirectoryListing {
  return {
    host_id: fileSessionId.includes('second') ? 'target-b' : 'target-a',
    file_session_id: fileSessionId,
    path,
    parent_path: path === '/' ? '/' : '/',
    entries,
    read_at: '2026-08-15T00:00:00Z',
  }
}

function task(): TransferTask {
  return {
    id: 'transfer-1',
    host_id: 'source',
    file_session_id: 'source-session',
    type: 'remote_copy',
    status: 'queued',
    source_paths: ['/srv/demo.txt'],
    target_path: '/home/target-a',
    total_bytes: 0,
    transferred_bytes: 0,
    remaining_bytes: 0,
    total_files: 0,
    completed_files: 0,
    progress_percent: 0,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 0,
    elapsed_seconds: 0,
    cancellable: true,
    retryable: false,
    overwrite_policy: 'rename',
    created_at: '2026-08-15T00:00:00Z',
  }
}

function baseProps(
  patch: Partial<RemoteCopyModalProps> = {},
): RemoteCopyModalProps {
  return {
    open: true,
    source: {
      hostId: 'source',
      fileSessionId: 'source-session',
      connectionGeneration: 3,
      entries: [entry('demo.txt', '/srv/demo.txt')],
    },
    hosts: [
      host('source', '源主机'),
      host('target-a', '目标主机 A'),
      host('target-b', '目标主机 B'),
    ],
    fileSessions: [
      fileSession('source-session', 'source', 3),
      fileSession('target-first-12345678', 'target-a', 4),
      fileSession('target-extra-87654321', 'target-a', 5),
      fileSession('target-second-abcdefgh', 'target-b', 6),
    ],
    getHostIconUrl: vi.fn((iconId: string) => `/api/v1/host-icons/${iconId}/file`),
    listDirectories: vi.fn(async (request: RemoteCopyDirectoryRequest) => (
      listing(request.fileSessionId, request.path, [
        entry('folder-z', `${request.path}/folder-z`, 'directory'),
        entry('plain.txt', `${request.path}/plain.txt`),
        entry('folder-a', `${request.path}/folder-a`, 'directory'),
      ])
    )),
    createDirectory: vi.fn(async () => undefined),
    createRemoteCopy: vi.fn(async () => task()),
    confirmOverwrite: vi.fn(async () => true),
    onCreated: vi.fn(),
    onClose: vi.fn(),
    ...patch,
  }
}

describe('跨主机传输目标弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('优先显示主机配置图标且未配置时回退默认图标', () => {
    const getHostIconUrl = vi.fn((iconId: string) => `/host-icons/${iconId}`)
    const props = baseProps({
      getHostIconUrl,
      hosts: [
        host('source', '源主机'),
        { ...host('target-a', '目标主机 A'), icon_id: 'icon-target-a' },
        host('target-b', '目标主机 B'),
      ],
    })
    render(<RemoteCopyModal {...props} />)

    const targetA = screen.getAllByRole('button', { name: /目标主机 A/ })[0]
    const targetB = screen.getByRole('button', { name: /目标主机 B/ })
    expect(targetA?.querySelector('img')).toHaveAttribute('src', '/host-icons/icon-target-a')
    expect(targetB.querySelector('img')).not.toBeInTheDocument()
    expect(getHostIconUrl).toHaveBeenCalledWith('icon-target-a')
  })

  it('过滤源主机并支持搜索、多会话区分和只读目录浏览', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const view = render(<RemoteCopyModal {...props} />)

    await waitFor(() => expect(props.listDirectories).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /源主机/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /目标主机 A/ })).toHaveLength(2)
    expect(screen.getByText('files.remoteCopy.sessionSuffix:12345678')).toBeInTheDocument()
    expect(screen.getByText('folder-a')).toBeInTheDocument()
    expect(screen.getByText('folder-z')).toBeInTheDocument()
    expect(screen.queryByText('plain.txt')).not.toBeInTheDocument()
    expect(props.listDirectories).toHaveBeenLastCalledWith(expect.objectContaining({
      fileSessionId: 'target-first-12345678',
      path: '/home/target-a',
      rememberPath: false,
      signal: expect.any(AbortSignal),
    }))

    const search = screen.getByRole('textbox', { name: 'files.remoteCopy.searchSessions' })
    await user.type(search, '目标主机 B')
    expect(screen.getByRole('button', { name: /目标主机 A/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /目标主机 B/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await user.click(screen.getByRole('button', { name: /目标主机 B/ }))
    await waitFor(() => expect(props.listDirectories).toHaveBeenLastCalledWith(expect.objectContaining({
      fileSessionId: 'target-second-abcdefgh',
      rememberPath: false,
    })))
    await user.click(screen.getByRole('radio', { name: /files.remoteCopy.policySkip/ }))
    const browseCalls = vi.mocked(props.listDirectories).mock.calls.length
    view.rerender(<RemoteCopyModal
      {...props}
      fileSessions={[
        ...props.fileSessions,
        fileSession('target-third-ijklmnop', 'target-b', 7),
      ]}
    />)
    expect(search).toHaveValue('目标主机 B')
    expect(screen.getByRole('radio', { name: /files.remoteCopy.policySkip/ })).toBeChecked()
    expect(vi.mocked(props.listDirectories).mock.calls).toHaveLength(browseCalls)
  })

  it('在当前目标目录中行内新建文件夹并刷新列表', async () => {
    const user = userEvent.setup()
    const createDirectory = vi.fn(async () => undefined)
    const props = baseProps({ createDirectory })
    render(<RemoteCopyModal {...props} />)

    const newFolder = screen.getByRole('button', { name: 'files.newFolder' })
    await waitFor(() => expect(newFolder).toBeEnabled())
    await user.click(newFolder)
    const nameInput = screen.getByRole('textbox', { name: 'files.folderName' })
    await user.type(nameInput, '发布目录')
    await user.click(screen.getByRole('button', { name: 'app.create' }))

    await waitFor(() => expect(createDirectory).toHaveBeenCalledWith({
      fileSessionId: 'target-first-12345678',
      connectionGeneration: 4,
      path: '/home/target-a/发布目录',
    }))
    await waitFor(() => expect(props.listDirectories).toHaveBeenCalledTimes(2))
    expect(props.listDirectories).toHaveBeenLastCalledWith(expect.objectContaining({
      fileSessionId: 'target-first-12345678',
      path: '/home/target-a',
      rememberPath: false,
    }))
    expect(screen.queryByRole('textbox', { name: 'files.folderName' })).not.toBeInTheDocument()
  })

  it('拒绝非法文件夹名称且创建失败时保留输入', async () => {
    const user = userEvent.setup()
    const createDirectory = vi.fn(async () => {
      throw new Error('mkdir denied')
    })
    const props = baseProps({ createDirectory })
    render(<RemoteCopyModal {...props} />)

    const newFolder = screen.getByRole('button', { name: 'files.newFolder' })
    await waitFor(() => expect(newFolder).toBeEnabled())
    await user.click(newFolder)
    const nameInput = screen.getByRole('textbox', { name: 'files.folderName' })
    await user.type(nameInput, '../escape')
    await user.click(screen.getByRole('button', { name: 'app.create' }))
    expect(createDirectory).not.toHaveBeenCalled()
    expect(screen.getByText('files.remoteCopy.folderNameInvalid')).toBeInTheDocument()

    await user.clear(nameInput)
    await user.type(nameInput, 'reports')
    await user.click(screen.getByRole('button', { name: 'app.create' }))
    await waitFor(() => expect(createDirectory).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('mkdir denied')).toBeInTheDocument()
    expect(nameInput).toHaveValue('reports')
  })

  it('中止旧目录请求且迟到响应不能覆盖新目标', async () => {
    const requests: Array<{
      request: RemoteCopyDirectoryRequest
      resolve: (value: RemoteDirectoryListing) => void
    }> = []
    const listDirectories = vi.fn((request: RemoteCopyDirectoryRequest) => (
      new Promise<RemoteDirectoryListing>((resolve) => requests.push({ request, resolve }))
    ))
    const props = baseProps({ listDirectories })
    render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(requests).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /目标主机 B/ }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[0]?.request.signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'files.remoteCopy.submit' })).toBeDisabled()

    await act(async () => {
      requests[0]?.resolve(listing('target-first-12345678', '/late', [
        entry('迟到目录', '/late/stale', 'directory'),
      ]))
      requests[1]?.resolve(listing('target-second-abcdefgh', '/home/target-b', [
        entry('当前目录', '/home/target-b/current', 'directory'),
      ]))
    })
    await waitFor(() => expect(screen.getByText('当前目录')).toBeInTheDocument())
    expect(screen.queryByText('迟到目录')).not.toBeInTheDocument()
  })

  it('输入尚未加载的新目录时禁止提交且加载成功后恢复', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<RemoteCopyModal {...props} />)
    const submit = await screen.findByRole('button', { name: 'files.remoteCopy.submit' })
    await waitFor(() => expect(submit).toBeEnabled())

    expect(screen.queryByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.editPath' }))
    const pathInput = screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' })
    await user.clear(pathInput)
    await user.type(pathInput, '/srv/new-target')
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.go' }))
    await waitFor(() => expect(props.listDirectories).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/srv/new-target',
      rememberPath: false,
    })))
    await waitFor(() => expect(submit).toBeEnabled())
    await waitFor(() => expect(screen.queryByRole('textbox', {
      name: 'files.remoteCopy.targetDirectory',
    })).not.toBeInTheDocument())
  })

  it('支持 Enter 确认路径且 Escape 取消时恢复当前目录', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<RemoteCopyModal {...props} />)

    const editPath = screen.getByRole('button', { name: 'files.remoteCopy.editPath' })
    await waitFor(() => expect(editPath).toBeEnabled())
    expect(screen.queryByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .not.toBeInTheDocument()

    await user.click(editPath)
    let pathInput = screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' })
    await user.clear(pathInput)
    await user.type(pathInput, '/cancelled-path')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.editPath' }))
    pathInput = screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' })
    expect(pathInput).toHaveValue('/home/target-a')
    await user.clear(pathInput)
    await user.type(pathInput, '/srv/enter-target')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(props.listDirectories).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/srv/enter-target',
      rememberPath: false,
    })))
    await waitFor(() => expect(screen.queryByRole('textbox', {
      name: 'files.remoteCopy.targetDirectory',
    })).not.toBeInTheDocument())
  })

  it('目标会话外部路径变化不会重置独立目录浏览状态', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const view = render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(props.listDirectories).toHaveBeenCalledTimes(1))

    await user.click(screen.getByText('folder-a'))
    await waitFor(() => expect(props.listDirectories).toHaveBeenCalledTimes(2))
    expect(props.listDirectories).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/home/target-a/folder-a',
    }))

    view.rerender(<RemoteCopyModal
      {...props}
      fileSessions={props.fileSessions.map((session) => (
        session.id === 'target-first-12345678'
          ? { ...session, current_path: '/changed-elsewhere' }
          : session
      ))}
    />)

    expect(props.listDirectories).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.editPath' }))
    expect(screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .toHaveValue('/home/target-a/folder-a')
  })

  it('在单个与批量模式间往返时保留单个主机的目标目录和冲突策略', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(props.listDirectories).toHaveBeenCalledTimes(1))

    await user.click(screen.getByText('folder-a'))
    await waitFor(() => expect(props.listDirectories).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('radio', { name: /files.remoteCopy.policySkip/ }))

    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    await user.click(screen.getByText('files.remoteCopy.modeSingle'))

    expect(props.listDirectories).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('radio', { name: /files.remoteCopy.policySkip/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.editPath' }))
    expect(screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .toHaveValue('/home/target-a/folder-a')
  })

  it('单个和批量模式统一统计当前有效的 SFTP 会话', async () => {
    const user = userEvent.setup()
    const props = baseProps()
    const view = render(<RemoteCopyModal {...props} />)

    expect(screen.getByLabelText('files.remoteCopy.availableSessions')).toHaveTextContent('3')
    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    const batchTargets = screen.getByRole('complementary', {
      name: 'files.remoteCopy.targetHosts',
    })
    expect(within(batchTargets).getByLabelText('files.remoteCopy.availableSessions'))
      .toHaveTextContent('3')

    await user.click(within(batchTargets).getAllByRole('checkbox', { name: /目标主机 A/ })[0]!)
    await user.type(
      within(batchTargets).getByPlaceholderText('files.remoteCopy.searchSessions'),
      '目标主机 A',
    )
    expect(within(batchTargets).getByLabelText('files.remoteCopy.availableSessions'))
      .toHaveTextContent('3')

    view.rerender(<RemoteCopyModal
      {...props}
      fileSessions={props.fileSessions.map((session) => (
        session.id === 'target-second-abcdefgh'
          ? { ...session, status: 'failed' }
          : session
      ))}
    />)
    expect(screen.getByLabelText('files.remoteCopy.availableSessions')).toHaveTextContent('2')

    await user.click(screen.getByText('files.remoteCopy.modeSingle'))
    expect(screen.getByLabelText('files.remoteCopy.availableSessions')).toHaveTextContent('2')
  })

  it('目录加载失败后重试原请求路径而不是上次成功目录', async () => {
    const user = userEvent.setup()
    const listDirectories = vi.fn(async (request: RemoteCopyDirectoryRequest) => {
      if (request.path === '/failed-target') {
        throw new Error('failed')
      }
      return listing(request.fileSessionId, request.path)
    })
    const props = baseProps({ listDirectories })
    render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(listDirectories).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.editPath' }))
    const pathInput = screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' })
    await user.clear(pathInput)
    await user.type(pathInput, '/failed-target')
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.go' }))
    await waitFor(() => expect(screen.getByText('files.remoteCopy.directoryLoadFailed')).toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .toHaveValue('/failed-target')

    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.directoryRetry' }))
    await waitFor(() => expect(listDirectories).toHaveBeenCalledTimes(3))
    expect(listDirectories).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/failed-target',
    }))
  })

  it('冻结请求参数、二次确认覆盖并阻止不支持的顶层条目', async () => {
    const user = userEvent.setup()
    const confirmOverwrite = vi.fn(async () => false)
    const createRemoteCopy = vi.fn(async () => task())
    const props = baseProps({ confirmOverwrite, createRemoteCopy })
    const view = render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(props.listDirectories).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'files.remoteCopy.submit' })).toBeEnabled())

    await user.click(screen.getByRole('radio', { name: /files.remoteCopy.policyOverwrite/ }))
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.submit' }))
    await waitFor(() => expect(confirmOverwrite).toHaveBeenCalledWith({
      mode: 'single',
      sourceCount: 1,
      targetHostName: '目标主机 A',
      targetPath: '/home/target-a',
    }))
    expect(createRemoteCopy).not.toHaveBeenCalled()

    confirmOverwrite.mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.submit' }))
    await waitFor(() => expect(createRemoteCopy).toHaveBeenCalledWith({
      sourceFileSessionId: 'source-session',
      sourceConnectionGeneration: 3,
      targetFileSessionId: 'target-first-12345678',
      targetConnectionGeneration: 4,
      sourcePaths: ['/srv/demo.txt'],
      targetDir: '/home/target-a',
      targetDirMode: 'require_existing',
      overwritePolicy: 'overwrite',
    }))
    expect(props.onCreated).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'transfer-1' }),
    ])
    expect(props.onClose).toHaveBeenCalled()

    view.unmount()
    render(<RemoteCopyModal {...baseProps({
      source: {
        ...props.source,
        entries: [entry('link', '/srv/link', 'symlink')],
      },
    })} />)
    expect(screen.getByText('files.remoteCopy.unsupportedSelection')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.remoteCopy.submit' })).toBeDisabled()
  })

  it('覆盖确认期间 generation 变化时拒绝提交陈旧目标', async () => {
    const user = userEvent.setup()
    let resolveConfirmation!: (confirmed: boolean) => void
    const confirmOverwrite = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    }))
    const createRemoteCopy = vi.fn(async () => task())
    const props = baseProps({ confirmOverwrite, createRemoteCopy })
    const view = render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'files.remoteCopy.submit' })).toBeEnabled())
    await user.click(screen.getByRole('radio', { name: /files.remoteCopy.policyOverwrite/ }))
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.submit' }))
    await waitFor(() => expect(confirmOverwrite).toHaveBeenCalled())

    view.rerender(<RemoteCopyModal
      {...props}
      fileSessions={props.fileSessions.map((session) => (
        session.id === 'target-first-12345678'
          ? { ...session, connection_generation: 9 }
          : session
      ))}
    />)
    await act(async () => resolveConfirmation(true))

    await waitFor(() => expect(screen.getByText('files.remoteCopy.sessionChanged')).toBeInTheDocument())
    expect(createRemoteCopy).not.toHaveBeenCalled()
  })

  it('覆盖确认期间源会话 generation 变化时拒绝提交陈旧来源', async () => {
    const user = userEvent.setup()
    let resolveConfirmation!: (confirmed: boolean) => void
    const confirmOverwrite = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    }))
    const createRemoteCopy = vi.fn(async () => task())
    const props = baseProps({ confirmOverwrite, createRemoteCopy })
    const view = render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'files.remoteCopy.submit' })).toBeEnabled())
    await user.click(screen.getByRole('radio', { name: /files.remoteCopy.policyOverwrite/ }))
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.submit' }))
    await waitFor(() => expect(confirmOverwrite).toHaveBeenCalled())

    view.rerender(<RemoteCopyModal
      {...props}
      source={{ ...props.source, connectionGeneration: 8 }}
    />)
    await act(async () => resolveConfirmation(true))

    await waitFor(() => expect(screen.getByText('files.remoteCopy.sessionChanged')).toBeInTheDocument())
    expect(createRemoteCopy).not.toHaveBeenCalled()
  })

  it('覆盖确认期间卸载后不再创建传输任务', async () => {
    const user = userEvent.setup()
    let resolveConfirmation!: (confirmed: boolean) => void
    const confirmOverwrite = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    }))
    const createRemoteCopy = vi.fn(async () => task())
    const props = baseProps({ confirmOverwrite, createRemoteCopy })
    const view = render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'files.remoteCopy.submit' })).toBeEnabled())
    await user.click(screen.getByRole('radio', { name: /files.remoteCopy.policyOverwrite/ }))
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.submit' }))
    await waitFor(() => expect(confirmOverwrite).toHaveBeenCalled())

    view.unmount()
    await act(async () => resolveConfirmation(true))

    expect(createRemoteCopy).not.toHaveBeenCalled()
    expect(props.onCreated).not.toHaveBeenCalled()
  })

  it('创建请求未完成时重复触发提交也只执行一次', async () => {
    let resolveCreate!: (value: TransferTask) => void
    const createRemoteCopy = vi.fn(() => new Promise<TransferTask>((resolve) => {
      resolveCreate = resolve
    }))
    const props = baseProps({ createRemoteCopy })
    render(<RemoteCopyModal {...props} />)
    const submit = await screen.findByRole('button', { name: 'files.remoteCopy.submit' })
    await waitFor(() => expect(submit).toBeEnabled())

    await act(async () => {
      submit.click()
      submit.click()
    })

    expect(createRemoteCopy).toHaveBeenCalledTimes(1)
    await act(async () => resolveCreate(task()))
    expect(props.onCreated).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('批量模式使用同一绝对路径且同一主机的会话互斥', async () => {
    const user = userEvent.setup()
    const createRemoteCopy = vi.fn(async (request: RemoteCopyCreateRequest) => ({
      ...task(),
      id: `transfer-${request.targetFileSessionId}`,
      target_file_session_id: request.targetFileSessionId,
      target_connection_generation: request.targetConnectionGeneration,
      target_path: request.targetDir,
    }))
    const props = baseProps({ createRemoteCopy })
    render(<RemoteCopyModal {...props} />)
    await waitFor(() => expect(props.listDirectories).toHaveBeenCalledTimes(1))

    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    expect(screen.getByText('files.remoteCopy.descriptionBatch')).toBeInTheDocument()
    const targetACheckboxes = screen.getAllByRole('checkbox', { name: /目标主机 A/ })
    const targetBCheckbox = screen.getByRole('checkbox', { name: /目标主机 B/ })
    await user.click(targetACheckboxes[0]!)
    expect(targetACheckboxes[0]).toBeChecked()
    await user.click(targetACheckboxes[1]!)
    expect(targetACheckboxes[0]).not.toBeChecked()
    expect(targetACheckboxes[1]).toBeChecked()
    await user.click(targetBCheckbox)

    const targetPath = screen.getByRole('textbox', {
      name: 'files.remoteCopy.targetDirectory',
    })
    await user.type(targetPath, 'relative/path')
    expect(screen.getByText('files.remoteCopy.batchPathInvalid')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' })).toBeDisabled()
    await user.clear(targetPath)
    await user.type(targetPath, '/srv/shared/inbox')
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' }))

    await waitFor(() => expect(createRemoteCopy).toHaveBeenCalledTimes(2))
    expect(createRemoteCopy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      targetFileSessionId: 'target-extra-87654321',
      targetConnectionGeneration: 5,
      targetDir: '/srv/shared/inbox',
      targetDirMode: 'create_if_missing',
    }))
    expect(createRemoteCopy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      targetFileSessionId: 'target-second-abcdefgh',
      targetConnectionGeneration: 6,
      targetDir: '/srv/shared/inbox',
      targetDirMode: 'create_if_missing',
    }))
    expect(props.onCreated).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'transfer-target-extra-87654321' }),
      expect.objectContaining({ id: 'transfer-target-second-abcdefgh' }),
    ])
    expect(props.createDirectory).not.toHaveBeenCalled()
    expect(props.listDirectories).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('批量提交连续触发时每个目标也只创建一次任务', async () => {
    const user = userEvent.setup()
    let resolveCreate!: (value: TransferTask) => void
    const createRemoteCopy = vi.fn(() => new Promise<TransferTask>((resolve) => {
      resolveCreate = resolve
    }))
    const props = baseProps({ createRemoteCopy })
    render(<RemoteCopyModal {...props} />)
    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    await user.click(screen.getAllByRole('checkbox', { name: /目标主机 A/ })[0]!)
    await user.type(
      screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }),
      '/srv/deduplicated',
    )
    const submit = screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' })

    await act(async () => {
      submit.click()
      submit.click()
    })

    expect(createRemoteCopy).toHaveBeenCalledTimes(1)
    await act(async () => resolveCreate(task()))
    expect(props.onCreated).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('批量创建部分成功时锁定成功目标并只保留失败目标重试', async () => {
    const user = userEvent.setup()
    let targetBShouldFail = true
    const createRemoteCopy = vi.fn(async (request: RemoteCopyCreateRequest) => {
      if (request.targetFileSessionId === 'target-second-abcdefgh' && targetBShouldFail) {
        throw new Error('target unavailable')
      }
      return {
        ...task(),
        id: `transfer-${request.targetFileSessionId}`,
        target_file_session_id: request.targetFileSessionId,
        target_path: request.targetDir,
      }
    })
    const props = baseProps({ createRemoteCopy })
    render(<RemoteCopyModal {...props} />)
    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    const targetA = screen.getAllByRole('checkbox', { name: /目标主机 A/ })[0]!
    const targetB = screen.getByRole('checkbox', { name: /目标主机 B/ })
    await user.click(targetA)
    await user.click(targetB)
    await user.type(
      screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }),
      '/srv/batch',
    )
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' }))

    await waitFor(() => expect(screen.getByText('files.remoteCopy.batchPartialTitle')).toBeInTheDocument())
    expect(screen.getByText('target unavailable')).toBeInTheDocument()
    expect(props.onCreated).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'transfer-target-first-12345678' }),
    ])
    expect(props.onClose).not.toHaveBeenCalled()
    expect(targetA).toBeDisabled()
    expect(targetA.closest('label')).toHaveAttribute('aria-disabled', 'true')
    expect(targetB).toBeChecked()
    expect(targetB).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }))
      .toBeDisabled()
    expect(screen.getByRole('radio', { name: /files.remoteCopy.policyRename/ }))
      .toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchRetry' }))
    await waitFor(() => expect(createRemoteCopy).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'files.remoteCopy.batchRetry',
    })).toBeEnabled())
    expect(screen.getByText('files.remoteCopy.batchPartialTitle')).toBeInTheDocument()
    expect(props.onCreated).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()

    targetBShouldFail = false
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchRetry' }))
    await waitFor(() => expect(createRemoteCopy).toHaveBeenCalledTimes(4))
    expect(createRemoteCopy.mock.calls[3]?.[0].targetFileSessionId)
      .toBe('target-second-abcdefgh')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('批量请求结果不确定时禁止直接重试', async () => {
    const user = userEvent.setup()
    const createRemoteCopy = vi.fn(async () => {
      throw new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0)
    })
    const props = baseProps({ createRemoteCopy })
    const view = render(<RemoteCopyModal {...props} />)
    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    const target = screen.getByRole('checkbox', { name: /目标主机 B/ })
    await user.click(target)
    await user.type(
      screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }),
      '/srv/uncertain',
    )
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' }))

    await waitFor(() => expect(screen.getByText('files.remoteCopy.batchUncertain')).toBeInTheDocument())
    expect(createRemoteCopy).toHaveBeenCalledTimes(1)
    expect(target).not.toBeChecked()
    expect(target).toBeDisabled()
    expect(target.closest('label')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'files.remoteCopy.batchRetry' })).toBeDisabled()
    expect(props.onCreated).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()

    view.rerender(<RemoteCopyModal
      {...props}
      fileSessions={props.fileSessions.map((session) => (
        session.id === 'target-second-abcdefgh'
          ? fileSession('target-second-new-ijklmnop', 'target-b', 7)
          : session
      ))}
    />)
    const reconnectedTarget = await screen.findByRole('checkbox', { name: /目标主机 B/ })
    expect(reconnectedTarget).toBeDisabled()
    expect(reconnectedTarget).not.toBeChecked()
    expect(screen.getByText('files.remoteCopy.batchUncertain')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.remoteCopy.batchRetry' })).toBeDisabled()
  })

  it('批量重试保留其他主机的不确定结果和已完成主机状态', async () => {
    const user = userEvent.setup()
    let retryTargetB = false
    const createRemoteCopy = vi.fn(async (request: RemoteCopyCreateRequest) => {
      if (request.targetFileSessionId === 'target-first-12345678') {
        throw new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0)
      }
      if (!retryTargetB) {
        throw new Error('target unavailable')
      }
      return {
        ...task(),
        id: `transfer-${request.targetFileSessionId}`,
        target_file_session_id: request.targetFileSessionId,
        target_path: request.targetDir,
      }
    })
    const props = baseProps({ createRemoteCopy })
    const view = render(<RemoteCopyModal {...props} />)
    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    await user.click(screen.getAllByRole('checkbox', { name: /目标主机 A/ })[0]!)
    await user.click(screen.getByRole('checkbox', { name: /目标主机 B/ }))
    await user.type(
      screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }),
      '/srv/mixed-failure',
    )
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' }))

    await waitFor(() => expect(screen.getByText('files.remoteCopy.batchUncertain')).toBeInTheDocument())
    expect(screen.getByText('target unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.remoteCopy.batchRetry' })).toBeEnabled()

    retryTargetB = true
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchRetry' }))
    await waitFor(() => expect(createRemoteCopy).toHaveBeenCalledTimes(3))
    expect(screen.getByText('files.remoteCopy.batchUncertain')).toBeInTheDocument()
    expect(screen.queryByText('target unavailable')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.remoteCopy.batchRetry' })).toBeDisabled()
    expect(props.onCreated).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'transfer-target-second-abcdefgh' }),
    ])
    expect(props.onClose).not.toHaveBeenCalled()

    view.rerender(<RemoteCopyModal
      {...props}
      fileSessions={props.fileSessions.map((session) => (
        session.id === 'target-second-abcdefgh'
          ? fileSession('target-second-new-ijklmnop', 'target-b', 7)
          : session
      ))}
    />)
    const reconnectedCompletedTarget = await screen.findByRole('checkbox', { name: /目标主机 B/ })
    expect(reconnectedCompletedTarget).toBeChecked()
    expect(reconnectedCompletedTarget).toBeDisabled()
  })

  it('批量请求期间来源变化时只登记旧任务且不污染或关闭新弹窗', async () => {
    const user = userEvent.setup()
    let resolveCreate!: (value: TransferTask) => void
    const createRemoteCopy = vi.fn(() => new Promise<TransferTask>((resolve) => {
      resolveCreate = resolve
    }))
    const props = baseProps({ createRemoteCopy })
    const view = render(<RemoteCopyModal {...props} />)
    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    await user.click(screen.getAllByRole('checkbox', { name: /目标主机 A/ })[0]!)
    await user.type(
      screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }),
      '/srv/source-change',
    )
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' }))
    await waitFor(() => expect(createRemoteCopy).toHaveBeenCalledTimes(1))

    view.rerender(<RemoteCopyModal
      {...props}
      source={{
        ...props.source,
        fileSessionId: 'source-session-new',
        connectionGeneration: 4,
        entries: [entry('next.txt', '/srv/next.txt')],
      }}
    />)
    await waitFor(() => expect(screen.getByText('files.remoteCopy.modeSingle')).toBeInTheDocument())
    await act(async () => resolveCreate({ ...task(), id: 'transfer-from-old-source' }))

    expect(props.onCreated).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'transfer-from-old-source' }),
    ])
    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('files.remoteCopy.batchPartialTitle')).not.toBeInTheDocument()
  })

  it('批量覆盖只确认一次并冻结全部目标', async () => {
    const user = userEvent.setup()
    const confirmOverwrite = vi.fn(async () => false)
    const createRemoteCopy = vi.fn(async () => task())
    const props = baseProps({ confirmOverwrite, createRemoteCopy })
    render(<RemoteCopyModal {...props} />)
    await user.click(screen.getByText('files.remoteCopy.modeBatch'))
    await user.click(screen.getAllByRole('checkbox', { name: /目标主机 A/ })[0]!)
    await user.click(screen.getByRole('checkbox', { name: /目标主机 B/ }))
    await user.type(
      screen.getByRole('textbox', { name: 'files.remoteCopy.targetDirectory' }),
      '/srv/overwrite',
    )
    await user.click(screen.getByRole('radio', { name: /files.remoteCopy.policyOverwrite/ }))
    await user.click(screen.getByRole('button', { name: 'files.remoteCopy.batchSubmit' }))

    await waitFor(() => expect(confirmOverwrite).toHaveBeenCalledTimes(1))
    expect(confirmOverwrite).toHaveBeenCalledWith({
      mode: 'batch',
      sourceCount: 1,
      targetCount: 2,
      targetPath: '/srv/overwrite',
    })
    expect(createRemoteCopy).not.toHaveBeenCalled()
  })
})
