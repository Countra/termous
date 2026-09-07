import { useCallback, useRef, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortcutRuntimeProvider } from '#app/shortcut-runtime'
import type { RemoteFileEntry } from '#entities/file'
import type { ShortcutSettings } from '#entities/shortcuts'
import { WorkbenchFileList } from './WorkbenchFileList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const shortcutSettings: ShortcutSettings = {
  schema_version: 1,
  overrides: {},
}

const entries: RemoteFileEntry[] = [
  {
    name: 'first.txt',
    path: '/workspace/first.txt',
    kind: 'file',
    size: 12,
    modified_at: '2026-08-22T00:00:00Z',
    is_hidden: false,
  },
  {
    name: 'target.txt',
    path: '/workspace/target.txt',
    kind: 'file',
    size: 24,
    modified_at: '2026-08-22T00:00:00Z',
    is_hidden: false,
  },
]

interface FileListHarnessProps {
  revealPath: string | null
  initialSelectedPaths?: string[]
  onSelectPaths?: (paths: string[]) => void
  onRevealSettled?: (path: string) => void
}

function FileListHarness({
  revealPath,
  initialSelectedPaths = [],
  onSelectPaths,
  onRevealSettled,
}: FileListHarnessProps) {
  const [selectedPaths, setSelectedPaths] = useState(initialSelectedPaths)
  const listRef = useRef<HTMLDivElement>(null)
  const handleSelectPaths = useCallback((paths: string[]) => {
    setSelectedPaths(paths)
    onSelectPaths?.(paths)
  }, [onSelectPaths])

  return (
    <ShortcutRuntimeProvider settings={shortcutSettings}>
      <WorkbenchFileList
        entries={entries}
        selectedPaths={selectedPaths}
        listingPath="/workspace"
        loading={false}
        initialPlaceholder={false}
        initialPending={false}
        navigationPending={false}
        pendingPath=""
        uploading={false}
        revealPath={revealPath}
        listRef={listRef}
        menuFor={() => ({ items: [] })}
        onSelectPaths={handleSelectPaths}
        onOpen={async () => true}
        onScroll={() => undefined}
        onUploadDrop={() => undefined}
        onUploadFiles={() => undefined}
        onRevealSettled={onRevealSettled}
      />
    </ShortcutRuntimeProvider>
  )
}

let nextFrameId = 0
let frameCallbacks = new Map<number, FrameRequestCallback>()

function flushAnimationFrames() {
  const callbacks = [...frameCallbacks.values()]
  frameCallbacks.clear()
  act(() => {
    callbacks.forEach((callback) => callback(0))
  })
}

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 200,
    height: bottom - top,
    top,
    right: 200,
    bottom,
    left: 0,
    toJSON: () => ({}),
  }
}

describe('工作台文件列表定位', () => {
  beforeEach(() => {
    nextFrameId = 0
    frameCallbacks = new Map()
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId
      frameCallbacks.set(frameId, callback)
      return frameId
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => {
      frameCallbacks.delete(frameId)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('目标存在时选中并滚动聚焦，清空后可再次定位同一路径', () => {
    const onSelectPaths = vi.fn()
    const onRevealSettled = vi.fn()
    const view = render(
      <FileListHarness
        revealPath="/workspace/target.txt"
        onSelectPaths={onSelectPaths}
        onRevealSettled={onRevealSettled}
      />,
    )
    const list = screen.getByRole('listbox')
    const target = screen.getByRole('option', { name: 'target.txt' })
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(110, 140))

    expect(onSelectPaths).toHaveBeenCalledWith(['/workspace/target.txt'])
    expect(onRevealSettled).toHaveBeenCalledWith('/workspace/target.txt')
    expect(target).toHaveAttribute('aria-selected', 'true')

    flushAnimationFrames()

    expect(target).toHaveFocus()
    expect(list.scrollTop).toBe(40)

    view.rerender(
      <FileListHarness
        revealPath={null}
        onSelectPaths={onSelectPaths}
        onRevealSettled={onRevealSettled}
      />,
    )
    view.rerender(
      <FileListHarness
        revealPath="/workspace/target.txt"
        onSelectPaths={onSelectPaths}
        onRevealSettled={onRevealSettled}
      />,
    )
    flushAnimationFrames()

    expect(onSelectPaths).toHaveBeenCalledTimes(2)
    expect(onRevealSettled).toHaveBeenCalledTimes(2)
  })

  it('目标不在当前目录时保留已有选择且不聚焦或回报完成', () => {
    const onSelectPaths = vi.fn()
    const onRevealSettled = vi.fn()
    render(
      <FileListHarness
        revealPath="/workspace/missing.txt"
        initialSelectedPaths={['/workspace/first.txt']}
        onSelectPaths={onSelectPaths}
        onRevealSettled={onRevealSettled}
      />,
    )

    expect(screen.getByRole('option', { name: 'first.txt' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('option', { name: 'target.txt' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(onSelectPaths).not.toHaveBeenCalled()
    expect(onRevealSettled).not.toHaveBeenCalled()
    expect(frameCallbacks.size).toBe(0)
  })
})
