import { App as AntdApp } from 'antd'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSession, LocalPathMapping } from '#entities/file'
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

function fileGateway() {
  return {
    getFileSession: vi.fn().mockResolvedValue(session),
    fileSessionEventsUrl: vi.fn().mockReturnValue('ws://localhost/files-tour'),
    listFileSessionFiles: vi.fn().mockResolvedValue({
      file_session_id: session.id,
      host_id: session.host_id,
      path: session.current_path,
      parent_path: '/',
      entries: [],
      read_at: '2026-09-07T00:00:00Z',
    }),
    statFileSessionFile: vi.fn(),
    mkdirFileSessionFile: vi.fn(),
    renameFileSessionFile: vi.fn(),
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

function renderWorkspace(connected: boolean) {
  const api = fileGateway()
  const props: FilesWorkspaceProps = {
    fileGateway: api,
    automaticRemoteRequestsEnabled: false,
    getHostIconUrl: vi.fn(),
    data: {
      hosts: [],
      fileSessions: connected ? [session] : [],
      fileBookmarkGroups: [],
      fileBookmarks: [],
      localPathMappings: connected ? [mapping] : [],
      settings: { terminal: defaultTerminalSettings },
    },
    theme: 'dark',
    activeFileSession: connected ? session : null,
    closingFileSessionIds: [],
    bookmarkManagementIntent: null,
    onConsumeBookmarkManagementIntent: vi.fn(),
    onOpenFileSessionLauncher: vi.fn(),
    onConnectFileSession: vi.fn(),
    onSelectFileSession: vi.fn(),
    onCloseFileSession: vi.fn(),
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
  const view = render(
    <AntdApp>
      <ShortcutRuntimeContextProvider value={shortcutContext}>
        <TransferRuntimeContext.Provider value={transfers}>
          <GlobalFileSearchRuntimeProvider api={api} fileSessions={props.data.fileSessions}>
            <FilesWorkspaceRuntimeProvider>
              <FilesWorkspace {...props} />
            </FilesWorkspaceRuntimeProvider>
          </GlobalFileSearchRuntimeProvider>
        </TransferRuntimeContext.Provider>
      </ShortcutRuntimeContextProvider>
    </AntdApp>,
  )
  return { ...view, api, props, transfers }
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
