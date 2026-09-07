import {
  useEffect,
  useRef,
  type DragEvent,
} from 'react'
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type {
  FileSession,
  RemoteFileEntry,
} from '#entities/file'
import {
  beginRemoteFileDrag,
  remoteFileDragRegistry,
  type RemoteFileDragTransaction,
} from '#features/local-download'
import { useFilesWorkspaceDragController } from '../widgets/files-workspace/ui/useFilesWorkspaceDragController'

interface DragControllerCallbacks {
  onSelectPaths: ReturnType<typeof vi.fn<(paths: string[]) => void>>
  onSetActiveEntry: ReturnType<typeof vi.fn<(entry: RemoteFileEntry) => void>>
  onUploadLocalPaths: ReturnType<typeof vi.fn<(
    paths: string[],
    targetPath: string,
  ) => Promise<void>>>
  onMoveRemotePathsToDirectory: ReturnType<typeof vi.fn<(
    transaction: RemoteFileDragTransaction,
    targetPath: string,
  ) => Promise<void>>>
  onRemoteMoveUnavailable: ReturnType<typeof vi.fn<() => void>>
  onDroppedPathsUnavailable: ReturnType<typeof vi.fn<() => void>>
}

interface DragHarnessProps {
  session: FileSession
  selectedPaths?: string[]
  callbacks: DragControllerCallbacks
  onController?: (controller: ReturnType<typeof useFilesWorkspaceDragController>) => void
}

const sourceEntry: RemoteFileEntry = {
  name: 'source.txt',
  path: '/source.txt',
  kind: 'file',
  size: 12,
  is_hidden: false,
}

const targetEntry: RemoteFileEntry = {
  name: 'destination',
  path: '/destination',
  kind: 'directory',
  size: 0,
  is_hidden: false,
}

function fileSession(patch: Partial<FileSession> = {}): FileSession {
  return {
    id: 'file-session-a',
    host_id: 'host-a',
    origin: 'app',
    status: 'connected',
    current_path: '/',
    started_at: '2026-08-09T00:00:00.000Z',
    connected_at: '2026-08-09T00:00:01.000Z',
    connection_generation: 1,
    ...patch,
  }
}

function callbacks(): DragControllerCallbacks {
  return {
    onSelectPaths: vi.fn(),
    onSetActiveEntry: vi.fn(),
    onUploadLocalPaths: vi.fn(async () => undefined),
    onMoveRemotePathsToDirectory: vi.fn(async () => undefined),
    onRemoteMoveUnavailable: vi.fn(),
    onDroppedPathsUnavailable: vi.fn(),
  }
}

function createDataTransfer(initialTypes: string[] = []) {
  const values = new Map<string, string>()
  const types = [...initialTypes]
  const transfer = {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    files: {
      length: initialTypes.includes('Files') ? 1 : 0,
      item: () => null,
    },
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value)
      if (!types.includes(type)) {
        types.push(type)
      }
    },
    setDragImage: vi.fn(),
    types,
  }
  return transfer as unknown as DataTransfer
}

function DragHarness({
  session,
  selectedPaths = [],
  callbacks: handlers,
  onController,
}: DragHarnessProps) {
  const filesTableShellRef = useRef<HTMLDivElement>(null)
  const fileSessionsRef = useRef<readonly FileSession[]>([session])
  const activeFileSessionIdRef = useRef(session.id)
  const closingFileSessionIdsRef = useRef<ReadonlySet<string>>(new Set())
  fileSessionsRef.current = [session]
  activeFileSessionIdRef.current = session.id

  const controller = useFilesWorkspaceDragController({
    filesTableShellRef,
    activeFileSession: session,
    activeFileSessionClosing: false,
    fileActionsEnabled: true,
    loading: false,
    currentPath: '/',
    entries: [sourceEntry, targetEntry],
    selectedPaths,
    fileSessionsRef,
    activeFileSessionIdRef,
    closingFileSessionIdsRef,
    previewClassNames: {
      root: 'drag-preview',
      label: 'drag-preview-label',
      count: 'drag-preview-count',
    },
    ...handlers,
  })

  useEffect(() => {
    onController?.(controller)
  }, [controller, onController])

  const remoteEntryHandlers = (entry: RemoteFileEntry) => ({
    onDragStart: (event: DragEvent<HTMLDivElement>) => (
      controller.startRemoteMoveDrag(entry, event)
    ),
    onDragOver: (event: DragEvent<HTMLDivElement>) => (
      controller.updateRemoteMoveTarget(entry, event)
    ),
    onDragLeave: (event: DragEvent<HTMLDivElement>) => (
      controller.leaveRemoteMoveTarget(entry, event)
    ),
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      void controller.dropRemoteMoveTarget(entry, event)
    },
    onDragEnd: controller.resetDragState,
  })

  return (
    <section
      data-testid="drag-root"
      data-drag-active={controller.dragActive ? 'true' : 'false'}
      data-drop-target={controller.dropTargetDirectoryPath ?? ''}
      data-move-target={controller.remoteMoveTargetPath ?? ''}
      data-moving={controller.remoteMoveDrag ? 'true' : 'false'}
      onDragEnter={controller.onDragEnter}
      onDragOver={controller.onDragOver}
      onDragLeave={controller.onDragLeave}
      onDragEnd={controller.resetDragState}
      onDrop={(event) => void controller.onDrop(event)}
    >
      <div ref={filesTableShellRef}>
        <div className="ant-table-body" data-testid="scroll-container">
          <div
            data-testid="source-row"
            data-files-table-row=""
            data-files-entry-kind="file"
            data-row-key={sourceEntry.path}
            draggable
            {...remoteEntryHandlers(sourceEntry)}
          >
            <span data-file-kind-icon="">F</span>
            {sourceEntry.name}
          </div>
          <div
            data-testid="target-row"
            data-files-table-row=""
            data-files-entry-kind="directory"
            data-row-key={targetEntry.path}
            draggable
            {...remoteEntryHandlers(targetEntry)}
          >
            <span data-file-kind-icon="">D</span>
            {targetEntry.name}
          </div>
        </div>
      </div>
    </section>
  )
}

let originalBridgeDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termous')
})

afterEach(() => {
  remoteFileDragRegistry.clear()
  vi.restoreAllMocks()
  if (originalBridgeDescriptor) {
    Object.defineProperty(window, 'termous', originalBridgeDescriptor)
  } else {
    Reflect.deleteProperty(window, 'termous')
  }
})

describe('文件工作区拖拽控制器合同', () => {
  it('本地文件拖入目录后按原顺序消费路径并提交上传', async () => {
    const handlers = callbacks()
    const consumeDroppedFilePaths = vi.fn(async () => ['C:\\incoming\\source.txt'])
    const pathsFromFileList = vi.fn(async () => ['unused'])
    Object.defineProperty(window, 'termous', {
      configurable: true,
      value: {
        files: {
          consumeDroppedFilePaths,
          pathsFromFileList,
        },
      },
    })
    const view = render(
      <DragHarness session={fileSession()} callbacks={handlers} />,
    )
    const root = view.getByTestId('drag-root')
    const target = view.getByTestId('target-row')
    const transfer = createDataTransfer(['Files'])

    fireEvent.dragEnter(root, { dataTransfer: transfer })
    fireEvent.dragOver(target, { dataTransfer: transfer, clientY: 50 })

    expect(root).toHaveAttribute('data-drag-active', 'true')
    expect(root).toHaveAttribute('data-drop-target', '/destination')

    fireEvent.drop(target, { dataTransfer: transfer })

    await waitFor(() => {
      expect(handlers.onUploadLocalPaths).toHaveBeenCalledWith(
        ['C:\\incoming\\source.txt'],
        '/destination',
      )
    })
    expect(consumeDroppedFilePaths).toHaveBeenCalledWith(1)
    expect(pathsFromFileList).not.toHaveBeenCalled()
    expect(root).toHaveAttribute('data-drag-active', 'false')
    expect(root).toHaveAttribute('data-drop-target', '')
  })

  it('远端拖拽保留选择、预览和合法目录移动合同', async () => {
    const handlers = callbacks()
    const view = render(
      <DragHarness
        session={fileSession()}
        selectedPaths={[sourceEntry.path]}
        callbacks={handlers}
      />,
    )
    const source = view.getByTestId('source-row')
    const target = view.getByTestId('target-row')
    const transfer = createDataTransfer()

    fireEvent.dragStart(source, { dataTransfer: transfer })

    expect(handlers.onSelectPaths).toHaveBeenCalledWith([sourceEntry.path])
    expect(handlers.onSetActiveEntry).toHaveBeenCalledWith(sourceEntry)
    expect(document.body.querySelector('.drag-preview')).not.toBeNull()
    expect(transfer.setDragImage).toHaveBeenCalled()

    fireEvent.dragOver(target, { dataTransfer: transfer, clientY: 50 })
    expect(view.getByTestId('drag-root')).toHaveAttribute(
      'data-move-target',
      '/destination',
    )
    fireEvent.drop(target, { dataTransfer: transfer })

    await waitFor(() => {
      expect(handlers.onMoveRemotePathsToDirectory).toHaveBeenCalledWith(
        expect.objectContaining({
          fileSessionId: 'file-session-a',
          connectionGeneration: 1,
          paths: [sourceEntry.path],
        }),
        '/destination',
      )
    })
    expect(handlers.onRemoteMoveUnavailable).not.toHaveBeenCalled()
    expect(document.body.querySelector('.drag-preview')).toBeNull()
  })

  it('连接代次变化后释放旧事务并拒绝迟到的远端落放', async () => {
    const handlers = callbacks()
    const firstSession = fileSession()
    const view = render(
      <DragHarness session={firstSession} callbacks={handlers} />,
    )
    const transfer = createDataTransfer()
    fireEvent.dragStart(view.getByTestId('source-row'), { dataTransfer: transfer })
    expect(document.body.querySelector('.drag-preview')).not.toBeNull()

    view.rerender(
      <DragHarness
        session={fileSession({ connection_generation: 2 })}
        callbacks={handlers}
      />,
    )

    await waitFor(() => {
      expect(view.getByTestId('drag-root')).toHaveAttribute('data-moving', 'false')
      expect(document.body.querySelector('.drag-preview')).toBeNull()
    })
    fireEvent.drop(view.getByTestId('target-row'), { dataTransfer: transfer })

    await waitFor(() => expect(handlers.onRemoteMoveUnavailable).toHaveBeenCalledTimes(1))
    expect(handlers.onMoveRemotePathsToDirectory).not.toHaveBeenCalled()
  })

  it('拒绝注册表中仍存在但连接代次不匹配的远端事务', async () => {
    const handlers = callbacks()
    const view = render(
      <DragHarness
        session={fileSession({ connection_generation: 2 })}
        callbacks={handlers}
      />,
    )
    const transfer = createDataTransfer()
    beginRemoteFileDrag(transfer, {
      fileSessionId: 'file-session-a',
      hostId: 'host-a',
      connectionGeneration: 1,
      paths: [sourceEntry.path],
    })

    fireEvent.drop(view.getByTestId('target-row'), { dataTransfer: transfer })

    await waitFor(() => expect(handlers.onRemoteMoveUnavailable).toHaveBeenCalledTimes(1))
    expect(handlers.onMoveRemotePathsToDirectory).not.toHaveBeenCalled()
  })

  it.each([
    ['窗口失焦', () => window.dispatchEvent(new Event('blur'))],
    ['全局拖拽结束', () => document.dispatchEvent(new Event('dragend'))],
  ])('%s会清除预览并释放自动滚动帧', async (_name, dispatchCleanup) => {
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(41)
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    const handlers = callbacks()
    const view = render(
      <DragHarness session={fileSession()} callbacks={handlers} />,
    )
    const scrollContainer = view.getByTestId('scroll-container')
    Object.defineProperties(scrollContainer, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 20, writable: true },
    })
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const transfer = createDataTransfer()
    fireEvent.dragStart(view.getByTestId('source-row'), { dataTransfer: transfer })
    const dragOver = new MouseEvent('dragover', {
      bubbles: true,
      clientY: 95,
    })
    Object.defineProperty(dragOver, 'dataTransfer', { value: transfer })
    fireEvent(view.getByTestId('target-row'), dragOver)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    act(dispatchCleanup)

    await waitFor(() => {
      expect(view.getByTestId('drag-root')).toHaveAttribute('data-moving', 'false')
      expect(document.body.querySelector('.drag-preview')).toBeNull()
    })
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41)
  })
})
