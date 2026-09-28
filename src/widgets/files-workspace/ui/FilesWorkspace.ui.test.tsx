import { App as AntdApp, ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSession, LocalPathMapping, RemoteFileEntry } from '#entities/file'
import { defaultTerminalSettings } from '#entities/settings'
import { ShortcutRuntime, ShortcutRuntimeContextProvider } from '#entities/shortcuts'
import type { FileGateway } from '#features/files'
import { GlobalFileSearchRuntimeProvider } from '#features/remote-file'
import { TransferRuntimeContext, type TransferRuntimeValue } from '#features/transfers'
import { FilesWorkspaceRuntimeProvider } from '../model/FilesWorkspaceRuntimeProvider'
import {
  defaultFilesWorkspaceLayoutPreferences,
  filesWorkspaceLayoutStorageKey,
} from '../model/filesWorkspaceState'
import { FilesWorkspace, type FilesWorkspaceProps } from './FilesWorkspace'

vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

const session: FileSession = {
  id: 'files-tour',
  host_id: 'host-tour',
  origin: 'app',
  status: 'connected',
  current_path: '/srv',
  connection_generation: 1,
  started_at: '2026-09-07T00:00:00Z',
}

const mapping: LocalPathMapping = {
  id: 'mapping-tour',
  name: 'Downloads',
  path: 'D:\\Downloads',
  available: true,
  sort_order: 0,
  created_at: '2026-09-07T00:00:00Z',
  updated_at: '2026-09-07T00:00:00Z',
}

function fileGateway(
  activeSession: FileSession = session,
  entries: RemoteFileEntry[] = [],
) {
  return {
    getFileSession: vi.fn().mockResolvedValue(activeSession),
    fileSessionEventsUrl: vi.fn().mockReturnValue('ws://localhost/files-tour'),
    listFileSessionFiles: vi.fn().mockResolvedValue({
      file_session_id: activeSession.id,
      host_id: activeSession.host_id,
      path: activeSession.current_path,
      parent_path: '/',
      entries,
      read_at: '2026-09-07T00:00:00Z',
    }),
    statFileSessionFile: vi.fn(),
    calculateFileSessionDirectorySize: vi.fn(),
    mkdirFileSessionFile: vi.fn(),
    renameFileSessionFile: vi.fn(),
    createFileSessionRenameOperation: vi.fn(),
    createFileSessionMoveOperation: vi.fn(),
    chmodFileSessionFile: vi.fn(),
    deleteFileSessionFiles: vi.fn(),
    copyFileSessionFiles: vi.fn(),
    moveFileSessionFiles: vi.fn(),
    createFileSessionTextReadOperation: vi.fn(),
    createFileSessionTextSaveOperation: vi.fn(),
    createFileSessionImageReadOperation: vi.fn(),
    fileOperation: vi.fn(),
    fileOperationResult: vi.fn(),
    fileOperationBlobResult: vi.fn(),
    cancelFileOperation: vi.fn(),
    fileOperationEventsUrl: vi.fn(),
    createLocalFileGrant: vi.fn(),
    releaseLocalFileGrant: vi.fn(),
    createFileSessionUploadTransfer: vi.fn(),
    createFileSessionDownloadTransfer: vi.fn(),
    createRemoteCopyTransfer: vi.fn(),
    retryTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
    localPathMappingChildren: vi.fn().mockResolvedValue([]),
    localPathMappingStat: vi.fn(),
    fileRenamePresets: vi.fn(),
    createFileRenamePreset: vi.fn(),
    updateFileRenamePreset: vi.fn(),
    deleteFileRenamePreset: vi.fn(),
    previewFileSessionBatchRename: vi.fn(),
    createFileSessionBatchRename: vi.fn(),
    fileNameSearchCapability: vi.fn(),
    searchFileSessionNames: vi.fn(),
    installFileNameSearch: vi.fn(),
  } satisfies FileGateway
}

function renderWorkspace(
  connected: boolean,
  options: {
    activeSession?: FileSession
    entries?: RemoteFileEntry[]
    automaticRemoteRequestsEnabled?: boolean
    hostAssets?: FilesWorkspaceProps['data']['hostAssets']
  } = {},
) {
  const activeSession = options.activeSession ?? session
  const api = fileGateway(activeSession, options.entries)
  const props: FilesWorkspaceProps = {
    fileGateway: api,
    automaticRemoteRequestsEnabled: options.automaticRemoteRequestsEnabled ?? false,
    getHostIconUrl: vi.fn(),
    data: {
      hosts: [],
      hostAssets: options.hostAssets,
      fileSessions: connected ? [activeSession] : [],
      fileBookmarkGroups: [],
      fileBookmarks: [],
      localPathMappings: connected ? [mapping] : [],
      settings: { terminal: defaultTerminalSettings },
    },
    theme: 'dark',
    activeFileSession: connected ? activeSession : null,
    closingFileSessionIds: [],
    bookmarkManagementIntent: null,
    onConsumeBookmarkManagementIntent: vi.fn(),
    onOpenFileSessionLauncher: vi.fn(),
    onConnectFileSession: vi.fn(),
    onSelectFileSession: vi.fn(),
    onCloseFileSession: vi.fn(),
    onRestartFileSession: vi.fn(),
    onReconnectFileSession: vi.fn(),
    onUpdateFileSession: vi.fn(),
    onCreateFileBookmark: vi.fn(),
    onUpdateFileBookmark: vi.fn(),
    onDeleteFileBookmark: vi.fn(),
    onReorderFileBookmarks: vi.fn(),
    onCreateFileBookmarkGroup: vi.fn(),
    onUpdateFileBookmarkGroup: vi.fn(),
    onDeleteFileBookmarkGroup: vi.fn(),
    onReorderFileBookmarkGroups: vi.fn(),
    onCreateLocalPathMapping: vi.fn(),
    onUpdateLocalPathMapping: vi.fn(),
    onDeleteLocalPathMapping: vi.fn(),
    onReorderLocalPathMappings: vi.fn(),
  }
  const transfers: TransferRuntimeValue = {
    transfers: [],
    activeTransfers: [],
    connected: true,
    initialized: true,
    remoteCopyRefreshVersion: 0,
    refresh: vi.fn().mockResolvedValue(undefined),
    upsertTransfer: vi.fn(),
    removeTransfer: vi.fn(),
    consumeRemoteCopyRefreshEvents: vi.fn().mockReturnValue([]),
  }
  const shortcutContext = {
    runtime: new ShortcutRuntime({ index: { platform: 'win32', byChord: new Map() } }),
    platform: 'win32' as const,
    labels: new Map(),
    bindingSignatures: new Map(),
  }
  const renderTree = (currentProps: FilesWorkspaceProps) => (
    <ConfigProvider theme={{ token: { motion: false } }}><AntdApp>
      <ShortcutRuntimeContextProvider value={shortcutContext}>
        <TransferRuntimeContext.Provider value={transfers}>
          <GlobalFileSearchRuntimeProvider api={api} fileSessions={currentProps.data.fileSessions}>
            <FilesWorkspaceRuntimeProvider>
              <FilesWorkspace {...currentProps} />
            </FilesWorkspaceRuntimeProvider>
          </GlobalFileSearchRuntimeProvider>
        </TransferRuntimeContext.Provider>
      </ShortcutRuntimeContextProvider>
    </AntdApp></ConfigProvider>
  )
  const view = render(renderTree(props))
  return { ...view, api, props, transfers, rerenderWorkspace: (currentProps: FilesWorkspaceProps) => view.rerender(renderTree(currentProps)) }
}

let scrollToDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem(filesWorkspaceLayoutStorageKey)
  if (scrollToDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  }
})

describe('真实文件工作区向导入口', () => {
  it.each([
    { connected: false, description: '空连接、无映射' },
    { connected: true, description: '已有连接、可用本地映射' },
  ])('$description 下禁用自动请求时保留唯一入口且不展开面板或读取目录', async ({ connected }) => {
    vi.useFakeTimers()
    const savedLayout = JSON.stringify({
      ...defaultFilesWorkspaceLayoutPreferences,
      bookmarkRailExpanded: false,
    })
    localStorage.setItem(filesWorkspaceLayoutStorageKey, savedLayout)
    const { container, api, props, transfers } = renderWorkspace(connected)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    for (const anchor of ['files-bookmarks', 'files-local-directory', 'files-transfers']) {
      const matches = container.querySelectorAll(`[data-tour="${anchor}"]`)
      expect(matches).toHaveLength(1)
      expect(matches[0]?.tagName).toBe('BUTTON')
      expect(matches[0]).toBeVisible()
      expect(matches[0]).toHaveAttribute('aria-expanded', 'false')
      expect(matches[0]?.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull()
    }
    expect(container.querySelector('#files-bookmark-rail')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('#files-bookmarks-workbench')).toBeNull()
    expect(container.querySelector('#files-bottom-drawer')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('#files-local-download-console')).not.toBeVisible()
    expect(localStorage.getItem(filesWorkspaceLayoutStorageKey)).toBe(savedLayout)
    expect(api.listFileSessionFiles).not.toHaveBeenCalled()
    expect(api.localPathMappingChildren).not.toHaveBeenCalled()
    expect(api.getFileSession).not.toHaveBeenCalled()
    expect(api.fileSessionEventsUrl).not.toHaveBeenCalled()
    expect(transfers.refresh).not.toHaveBeenCalled()
    expect(props.onOpenFileSessionLauncher).not.toHaveBeenCalled()
    expect(props.onConnectFileSession).not.toHaveBeenCalled()
    expect(props.onReconnectFileSession).not.toHaveBeenCalled()
  })
})

describe('目录总大小详情入口', () => {
  const directory: RemoteFileEntry = {
    name: 'data',
    path: '/srv/data',
    kind: 'directory',
    size: 0,
    is_hidden: false,
  }

  it.each([
    { supported: true, expectedLabel: 'files.directorySize.label' },
    { supported: false, expectedLabel: 'files.size' },
  ])('能力支持为 $supported 时保持对应详情行为', async ({ supported, expectedLabel }) => {
    const activeSession: FileSession = {
      ...session,
      capabilities: supported ? ['directory_size'] : [],
    }
    const { api } = renderWorkspace(true, {
      activeSession,
      entries: [directory],
      automaticRemoteRequestsEnabled: true,
    })

    await waitFor(() => expect(api.listFileSessionFiles).toHaveBeenCalledOnce())
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'files.details' }))

    expect(await screen.findByText(expectedLabel)).toBeVisible()
    if (supported) {
      expect(screen.getByRole('button', { name: 'files.directorySize.calculate' })).toBeVisible()
    } else {
      expect(screen.queryByRole('button', { name: 'files.directorySize.calculate' })).toBeNull()
    }
  })
})

describe('主机下不同存储引擎的能力边界', () => {
  it('弹窗打开后会话重连，拒绝提交旧代次并只显示一次原因', async () => {
    const { api, props, rerenderWorkspace } = renderWorkspace(true, {
      activeSession: { ...session, capabilities: ['browse', 'entry_mutate'] },
      entries: [{ name: 'notes.txt', path: '/srv/notes.txt', kind: 'file', size: 1, is_hidden: false }],
      automaticRemoteRequestsEnabled: true,
    })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'files.rename' }))
    fireEvent.change(await screen.findByDisplayValue('notes.txt'), { target: { value: 'changed.txt' } })
    const reconnected = { ...props.activeFileSession!, connection_generation: 2 }
    api.getFileSession.mockResolvedValue(reconnected)
    rerenderWorkspace({ ...props, activeFileSession: reconnected, data: { ...props.data, fileSessions: [reconnected] } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    await waitFor(() => expect(screen.getAllByText('files.connectionRequired')).toHaveLength(1))
    expect(api.createFileSessionRenameOperation).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('changed.txt')).toBeInTheDocument()
  })

  it.each(['文件', '文件夹'])('改名被同名%s占用时显示原因，保留输入并允许修改后重试', async (kind) => {
    const { api } = renderWorkspace(true, {
      activeSession: { ...session, capabilities: ['browse', 'entry_mutate'] },
      entries: [{ name: 'notes.txt', path: '/srv/notes.txt', kind: 'file', size: 1, is_hidden: false }],
      automaticRemoteRequestsEnabled: true,
    })
    const message = `无法重命名：目标路径“/srv/occupied”已存在同名${kind}，请使用其他名称`
    api.createFileSessionRenameOperation.mockRejectedValueOnce(new Error(message))
    api.createFileSessionRenameOperation.mockResolvedValueOnce({
      id: 'rename-retry', revision: 1, file_session_id: session.id, type: 'move', status: 'completed', phase: 'done',
      path: '/srv/notes.txt', total_bytes: 1, transferred_bytes: 1, remaining_bytes: 0,
      phase_total_bytes: 1, phase_transferred_bytes: 1, phase_progress_percent: 100, progress_percent: 100,
      speed_bytes_per_sec: 0, average_speed_bytes_per_sec: 0, elapsed_seconds: 1, cancellable: false,
      created_at: session.started_at,
    })
    api.fileOperationResult.mockResolvedValue({ non_atomic: false, partial: false, uncertain: false, items: [
      { source_path: '/srv/notes.txt', target_path: '/srv/available', status: 'moved', removed: true },
    ] })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'files.rename' }))
    fireEvent.change(await screen.findByDisplayValue('notes.txt'), { target: { value: 'occupied' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))

    await waitFor(() => expect(screen.getByText(message)).toBeVisible())
    expect(screen.getByDisplayValue('occupied')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'app.update' })).not.toHaveClass('ant-btn-loading'))
    fireEvent.change(screen.getByDisplayValue('occupied'), { target: { value: 'available' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    await waitFor(() => expect(api.createFileSessionRenameOperation).toHaveBeenLastCalledWith(session.id, 1, '/srv/notes.txt', '/srv/available'))
    expect(await screen.findByTitle('/srv/available')).toHaveTextContent('available')
  })

  it.each([
    { name: '   ', error: 'files.nameRequired' },
    { name: 'notes.txt', error: 'files.nameUnchanged' },
  ])('名称为 "$name" 时显示校验错误而不提交改名', async ({ name, error }) => {
    const { api } = renderWorkspace(true, {
      activeSession: { ...session, capabilities: ['browse', 'entry_mutate'] },
      entries: [{ name: 'notes.txt', path: '/srv/notes.txt', kind: 'file', size: 1, is_hidden: false }],
      automaticRemoteRequestsEnabled: true,
    })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'files.rename' }))
    fireEvent.change(await screen.findByDisplayValue('notes.txt'), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    await waitFor(() => expect(screen.getByText(error)).toBeVisible())
    expect(api.createFileSessionRenameOperation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'app.update' })).toBeVisible()
  })

  it.each(['sftp', 's3'])('%s 改名使用相同动作与任务视图', async (engine) => {
    const { api } = renderWorkspace(true, {
      activeSession: { ...session, engine, capabilities: ['browse', 'entry_mutate'] },
      entries: [{ name: 'notes.txt', path: '/srv/notes.txt', kind: 'file', size: 1, is_hidden: false }],
      automaticRemoteRequestsEnabled: true,
    })
    api.createFileSessionRenameOperation.mockResolvedValue({
      id: 'move-task', revision: 1, file_session_id: session.id, engine, type: 'move', status: 'completed', phase: 'done',
      path: '/srv/notes.txt', total_bytes: 1, transferred_bytes: 1, remaining_bytes: 0,
      phase_total_bytes: 1, phase_transferred_bytes: 1, phase_progress_percent: 100, progress_percent: 100,
      speed_bytes_per_sec: 0, average_speed_bytes_per_sec: 0, elapsed_seconds: 1, cancellable: false,
      created_at: session.started_at,
    })
    api.fileOperationResult.mockResolvedValue({ non_atomic: engine === 's3', partial: false, uncertain: false, items: [
      { source_path: '/srv/notes.txt', target_path: '/srv/renamed.txt', status: 'moved', removed: true },
    ] })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'files.rename' }))
    fireEvent.change(await screen.findByDisplayValue('notes.txt'), { target: { value: 'renamed.txt' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    await waitFor(() => expect(api.createFileSessionRenameOperation).toHaveBeenCalledWith(session.id, 1, '/srv/notes.txt', '/srv/renamed.txt'))
    await waitFor(() => expect(api.fileOperationResult).toHaveBeenCalledWith('move-task'))
    expect(api.renameFileSessionFile).not.toHaveBeenCalled()
    expect(await screen.findByTitle('/srv/renamed.txt')).toHaveTextContent('renamed.txt')
    await waitFor(() => expect(screen.getByText('files.move.renameTitle')).toBeVisible())
  })

  it('S3 使用统一改名能力，隐藏权限、批量改名及 SSH 搜索', async () => {
    const { api } = renderWorkspace(true, {
      hostAssets: [{ id: session.host_id, name: '对象存储主机', platform: 'linux', group_id: '', tags: [], favorite: false, created_at: session.started_at, updated_at: session.started_at }],
      activeSession: { ...session, engine: 's3', capabilities: ['browse', 'content_read', 'content_write', 'entry_create', 'transfer', 'transfer_receive', 'entry_mutate', 'planned_delete'] },
      entries: [{ name: 'notes.txt', path: '/srv/notes.txt', kind: 'file', size: 1, is_hidden: false }],
      automaticRemoteRequestsEnabled: true,
    })
    await waitFor(() => expect(api.listFileSessionFiles).toHaveBeenCalledOnce())
    expect(screen.getByRole('tab', { name: /对象存储主机/ })).toBeVisible()
    const row = within(await screen.findByRole('row', { name: /notes\.txt/ }))
    fireEvent.click(row.getByRole('checkbox', { name: 'Select row 1' }))
    const rename = screen.getByRole('button', { name: 'files.rename' })
    const commands = within(rename.parentElement!)
    expect(rename).toBeEnabled()
    expect(commands.getByRole('button', { name: 'files.copy' })).toBeEnabled()
    expect(commands.queryByRole('button', { name: 'files.editPermissions' })).toBeNull()
    expect(commands.queryByRole('button', { name: 'files.advancedRename.action' })).toBeNull()
    const navigation = within(screen.getByRole('toolbar', { name: 'files.pathNavigation' }))
    expect(navigation.queryByRole('button', { name: 'files.globalSearch.action' })).toBeNull()

    fireEvent.click(row.getByRole('button', { name: 'files.actions' }))
    const menu = within(await screen.findByRole('menu'))
    await waitFor(() => expect(menu.getByRole('menuitem', { name: /files.rename/ })).toBeVisible())
    expect(menu.queryByRole('menuitem', { name: /files.editPermissions/ })).toBeNull()
    expect(menu.queryByRole('menuitem', { name: /files.advancedRename.action/ })).toBeNull()

    const panels = within(screen.getByRole('group', { name: 'files.workspacePanels' }))
    fireEvent.click(panels.getByRole('button', { name: 'files.details' }))
    const details = within(await screen.findByRole('complementary', { name: 'files.details' }))
    expect(details.getByText('对象存储主机')).toBeVisible()
    expect(details.queryByRole('button', { name: 'files.editPermissions' })).toBeNull()
    expect(details.queryByText('files.noHost')).toBeNull()
    expect(details.queryByText('files.ownerUid')).toBeNull()
    expect(details.queryByText('files.groupGid')).toBeNull()
    expect(details.queryByText('files.mode')).toBeNull()
  })

  it('只浏览能力拒绝双击读取和上传、移动', async () => {
    const { api } = renderWorkspace(true, {
      activeSession: { ...session, engine: 's3', capabilities: ['browse'] },
      entries: [{ name: 'notes.txt', path: '/srv/notes.txt', kind: 'file', size: 1, is_hidden: false }],
      automaticRemoteRequestsEnabled: true,
    })
    await waitFor(() => expect(api.listFileSessionFiles).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'files.uploadFiles' })).toBeDisabled()
    fireEvent.doubleClick(await screen.findByText('notes.txt'))
    expect(api.createFileSessionTextReadOperation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    expect(screen.getByRole('button', { name: 'files.rename' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'files.cut' })).toBeDisabled()
  })
})
