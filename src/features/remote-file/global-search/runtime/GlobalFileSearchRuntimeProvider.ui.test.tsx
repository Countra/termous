import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FileSession } from '#entities/file'
import type { FileNameSearchGateway } from '#features/files'
import type {
  GlobalFileSearchModalProps,
  GlobalFileSearchReveal,
} from '../model/types'
import { GlobalFileSearchRuntimeProvider } from './GlobalFileSearchRuntimeProvider'
import { useGlobalFileSearchRuntime } from './useGlobalFileSearchRuntime'

vi.mock('../ui/GlobalFileSearchModal.tsx', async () => {
  const { useState } = await import('react')

  return {
    GlobalFileSearchModal: ({
      open,
      source,
      onReveal,
      onClose,
    }: GlobalFileSearchModalProps) => {
      const [query, setQuery] = useState('')
      if (!open) {
        return null
      }

      return (
        <section aria-label="mock-global-search-modal">
          <input
            aria-label="mock-search-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <output data-testid="mock-current-path">{source.currentPath}</output>
          <output data-testid="mock-connection-generation">
            {source.connectionGeneration}
          </output>
          <button
            type="button"
            onClick={() => {
              void onReveal('/srv/report.txt', new AbortController().signal)
            }}
          >
            reveal-result
          </button>
          <button type="button" onClick={onClose}>close-modal</button>
        </section>
      )
    },
  }
})

const api: FileNameSearchGateway = {
  fileNameSearchCapability: vi.fn(),
  searchFileSessionNames: vi.fn(),
  installFileNameSearch: vi.fn(),
}

function fileSession(
  connectionGeneration: number,
  status: FileSession['status'] = 'connected',
): FileSession {
  return {
    id: 'file-session-1',
    host_id: 'host-1',
    origin: 'app',
    status,
    current_path: '/srv',
    started_at: '2026-08-22T00:00:00Z',
    connection_generation: connectionGeneration,
  }
}

interface RuntimeControlsProps {
  connectionGeneration: number
  onRevealA: GlobalFileSearchReveal
  onRevealB: GlobalFileSearchReveal
}

function RuntimeControls({
  connectionGeneration,
  onRevealA,
  onRevealB,
}: RuntimeControlsProps) {
  const { openSearch, closeSearch } = useGlobalFileSearchRuntime()

  return (
    <>
      <button
        type="button"
        onClick={() => openSearch({
          ownerId: 'files-page',
          source: {
            fileSessionId: 'file-session-1',
            connectionGeneration,
            hostName: 'Test host',
            currentPath: '/srv/files',
          },
          onReveal: onRevealA,
        })}
      >
        open-from-files
      </button>
      <button
        type="button"
        onClick={() => openSearch({
          ownerId: 'workbench',
          source: {
            fileSessionId: 'file-session-1',
            connectionGeneration,
            hostName: 'Test host',
            currentPath: '/srv/workbench',
          },
          onReveal: onRevealB,
        })}
      >
        open-from-workbench
      </button>
      <button type="button" onClick={() => closeSearch('files-page')}>
        close-from-files
      </button>
      <button type="button" onClick={() => closeSearch('workbench')}>
        close-from-workbench
      </button>
    </>
  )
}

interface RuntimeHarnessProps extends RuntimeControlsProps {
  fileSessions: readonly FileSession[]
  children?: ReactNode
}

function RuntimeHarness({
  fileSessions,
  connectionGeneration,
  onRevealA,
  onRevealB,
  children,
}: RuntimeHarnessProps) {
  return (
    <GlobalFileSearchRuntimeProvider api={api} fileSessions={fileSessions}>
      <RuntimeControls
        connectionGeneration={connectionGeneration}
        onRevealA={onRevealA}
        onRevealB={onRevealB}
      />
      {children}
    </GlobalFileSearchRuntimeProvider>
  )
}

function revealSpy() {
  return vi.fn<GlobalFileSearchReveal>(async () => ({ status: 'revealed' }))
}

describe('共享全局文件搜索 Runtime', () => {
  it('在相同连接的两个入口间保留弹窗状态并采用最新定位回调', async () => {
    const onRevealA = revealSpy()
    const onRevealB = revealSpy()
    render(
      <RuntimeHarness
        fileSessions={[fileSession(3)]}
        connectionGeneration={3}
        onRevealA={onRevealA}
        onRevealB={onRevealB}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'open-from-files' }))
    const queryInput = await screen.findByRole('textbox', { name: 'mock-search-query' })
    fireEvent.change(queryInput, { target: { value: 'report' } })
    fireEvent.click(screen.getByRole('button', { name: 'close-modal' }))
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'mock-search-query' }))
        .not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'open-from-workbench' }))
    expect(await screen.findByRole('textbox', { name: 'mock-search-query' }))
      .toHaveValue('report')
    expect(screen.getByTestId('mock-current-path')).toHaveTextContent('/srv/workbench')

    fireEvent.click(screen.getByRole('button', { name: 'reveal-result' }))
    await waitFor(() => expect(onRevealB).toHaveBeenCalledTimes(1))
    expect(onRevealA).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'close-from-files' }))
    expect(screen.getByRole('textbox', { name: 'mock-search-query' }))
      .toHaveValue('report')
  })

  it('connection generation 变化后销毁旧状态并为新连接创建空白实例', async () => {
    const onRevealA = revealSpy()
    const onRevealB = revealSpy()
    const view = render(
      <RuntimeHarness
        fileSessions={[fileSession(3)]}
        connectionGeneration={3}
        onRevealA={onRevealA}
        onRevealB={onRevealB}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'open-from-files' }))
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'mock-search-query' }),
      { target: { value: 'old-generation' } },
    )

    view.rerender(
      <RuntimeHarness
        fileSessions={[fileSession(4)]}
        connectionGeneration={4}
        onRevealA={onRevealA}
        onRevealB={onRevealB}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'mock-search-query' }))
        .not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'open-from-workbench' }))
    expect(await screen.findByRole('textbox', { name: 'mock-search-query' })).toHaveValue('')
    expect(screen.getByTestId('mock-connection-generation')).toHaveTextContent('4')
  })

  it('文件会话断连后清理状态且重连不会恢复旧搜索内容', async () => {
    const onRevealA = revealSpy()
    const onRevealB = revealSpy()
    const view = render(
      <RuntimeHarness
        fileSessions={[fileSession(3)]}
        connectionGeneration={3}
        onRevealA={onRevealA}
        onRevealB={onRevealB}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'open-from-files' }))
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'mock-search-query' }),
      { target: { value: 'before-disconnect' } },
    )

    view.rerender(
      <RuntimeHarness
        fileSessions={[fileSession(3, 'disconnected')]}
        connectionGeneration={3}
        onRevealA={onRevealA}
        onRevealB={onRevealB}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'mock-search-query' }))
        .not.toBeInTheDocument()
    })

    view.rerender(
      <RuntimeHarness
        fileSessions={[fileSession(3)]}
        connectionGeneration={3}
        onRevealA={onRevealA}
        onRevealB={onRevealB}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'open-from-workbench' }))
    expect(await screen.findByRole('textbox', { name: 'mock-search-query' })).toHaveValue('')
  })
})
