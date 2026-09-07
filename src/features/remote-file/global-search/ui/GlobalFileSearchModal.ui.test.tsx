import { App as AntdApp } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FileNameSearchCapability,
  FileNameSearchResult,
} from '#entities/file'
import type { FileNameSearchGateway } from '#features/files'
import type { GlobalFileSearchRevealResult } from '../model/types'
import { GlobalFileSearchModal } from './GlobalFileSearchModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function capability(): FileNameSearchCapability {
  return {
    status: 'ready',
    executable: 'fd',
    version: '10.2.0',
    minimum_version: '8.0.0',
    privilege: 'none',
    install_available: false,
    connection_generation: 3,
  }
}

function installableCapability(connectionGeneration = 3): FileNameSearchCapability {
  return {
    status: 'missing',
    minimum_version: '8.0.0',
    distribution: 'ubuntu',
    package_manager: 'apt-get',
    privilege: 'sudo',
    install_available: true,
    connection_generation: connectionGeneration,
    install_plan: {
      automatic: true,
      privilege: 'sudo',
      plan_hash: 'plan-1',
      commands: [
        {
          id: 'install-fd',
          title: '后端返回的安装标题',
          command: '/usr/bin/sudo -n -- /usr/bin/apt-get install -y fd-find',
        },
        {
          id: 'custom-step',
          title: 'Backend custom step',
          command: '/usr/bin/true',
        },
      ],
      manual_commands: [],
      warnings: [],
    },
  }
}

function searchResult(): FileNameSearchResult {
  return {
    items: [{ path: '/srv/report.txt', name: 'report.txt', parent_path: '/srv' }],
    returned_count: 1,
    truncated: false,
    partial: false,
    timed_out: false,
    skipped_invalid_utf8: 0,
    duration_ms: 20,
    connection_generation: 3,
    one_file_system: false,
  }
}

function gateway(): FileNameSearchGateway {
  return {
    fileNameSearchCapability: vi.fn(async () => capability()),
    searchFileSessionNames: vi.fn(async () => searchResult()),
    installFileNameSearch: vi.fn(async () => capability()),
  }
}

function SearchReopenHarness({ api }: { api: FileNameSearchGateway }) {
  const [open, setOpen] = useState(true)
  return (
    <AntdApp>
      <button
        type="button"
        aria-label="reopen-global-search"
        aria-pressed={open}
        onClick={() => setOpen(true)}
      >
        reopen-global-search
      </button>
      <GlobalFileSearchModal
        api={api}
        open={open}
        source={{
          fileSessionId: 'file-session-1',
          connectionGeneration: 3,
          hostName: 'Test host',
          currentPath: '/srv',
        }}
        onReveal={async () => ({ status: 'revealed' })}
        onClose={() => setOpen(false)}
      />
    </AntdApp>
  )
}

async function renderSearchResult(
  onReveal: (path: string, signal: AbortSignal) => Promise<GlobalFileSearchRevealResult>,
  onClose = vi.fn(),
) {
  render(
    <AntdApp>
      <GlobalFileSearchModal
        api={gateway()}
        open
        source={{
          fileSessionId: 'file-session-1',
          connectionGeneration: 3,
          hostName: 'Test host',
          currentPath: '/srv',
        }}
        onReveal={onReveal}
        onClose={onClose}
      />
    </AntdApp>,
  )
  const input = await screen.findByRole('textbox', {
    name: 'files.globalSearch.query',
  })
  fireEvent.change(input, { target: { value: 'report' } })
  fireEvent.click(screen.getByRole('button', {
    name: 'files.globalSearch.search',
  }))
  await screen.findByText('report.txt')
  return { onClose }
}

describe('GlobalFileSearchModal 定位生命周期', () => {
  it('定位关闭后重新打开时保留查询和上一轮结果', async () => {
    const api = gateway()
    render(<SearchReopenHarness api={api} />)

    const input = await screen.findByRole('textbox', {
      name: 'files.globalSearch.query',
    })
    fireEvent.change(input, { target: { value: 'report' } })
    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.search',
    }))
    await screen.findByText('report.txt')

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.revealNamed',
    }))
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'reopen-global-search',
      })).toHaveAttribute('aria-pressed', 'false')
    })

    fireEvent.click(screen.getByRole('button', { name: 'reopen-global-search' }))
    expect(await screen.findByRole('textbox', {
      name: 'files.globalSearch.query',
    })).toHaveValue('report')
    expect(await screen.findByText('report.txt')).toBeInTheDocument()
    expect(api.searchFileSessionNames).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('关闭弹窗会取消定位且旧结果不能再次触发关闭', async () => {
    const pending = deferred<GlobalFileSearchRevealResult>()
    const revealSignals: AbortSignal[] = []
    const onReveal = vi.fn((_path: string, signal: AbortSignal) => {
      revealSignals.push(signal)
      return pending.promise
    })
    const onClose = vi.fn()
    await renderSearchResult(onReveal, onClose)

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.revealNamed',
    }))
    await waitFor(() => expect(onReveal).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'app.close' }))

    expect(revealSignals[0]?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ status: 'revealed' })
      await pending.promise
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('瞬时定位失败不会把结果永久标记为不可用', async () => {
    const onReveal = vi.fn(async () => ({
      status: 'failed' as const,
      description: 'temporary failure',
    }))
    await renderSearchResult(onReveal)
    const revealButton = screen.getByRole('button', {
      name: 'files.globalSearch.revealNamed',
    })

    await act(async () => {
      fireEvent.click(revealButton)
      await Promise.resolve()
    })
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('files.globalSearch.staleResults')).not.toBeInTheDocument()
  }, 10_000)

  it('切换文件会话会销毁旧安装确认且不执行安装', async () => {
    const api = gateway()
    vi.mocked(api.fileNameSearchCapability).mockImplementation(async (
      _fileSessionId,
      connectionGeneration,
    ) => installableCapability(connectionGeneration))
    const renderResult = render(
      <AntdApp>
        <GlobalFileSearchModal
          api={api}
          open
          source={{
            fileSessionId: 'file-session-1',
            connectionGeneration: 3,
            hostName: 'First host',
            currentPath: '/srv',
          }}
          onReveal={vi.fn()}
          onClose={vi.fn()}
        />
      </AntdApp>,
    )

    fireEvent.click(await screen.findByRole('button', {
      name: 'files.globalSearch.install',
    }))
    await waitFor(() => {
      expect(screen.getAllByRole('button', {
        name: 'files.globalSearch.install',
      }).length).toBeGreaterThan(1)
    })
    expect(screen.getByText('files.globalSearch.installFdCommand')).toBeInTheDocument()
    expect(screen.queryByText('后端返回的安装标题')).not.toBeInTheDocument()
    expect(screen.getByText('Backend custom step')).toBeInTheDocument()

    renderResult.rerender(
      <AntdApp>
        <GlobalFileSearchModal
          api={api}
          open
          source={{
            fileSessionId: 'file-session-2',
            connectionGeneration: 1,
            hostName: 'Second host',
            currentPath: '/var',
          }}
          onReveal={vi.fn()}
          onClose={vi.fn()}
        />
      </AntdApp>,
    )

    await waitFor(() => {
      expect(api.fileNameSearchCapability).toHaveBeenLastCalledWith(
        'file-session-2',
        1,
        expect.any(AbortSignal),
      )
      expect(screen.getAllByRole('button', {
        name: 'files.globalSearch.install',
      })).toHaveLength(1)
    })
    expect(api.installFileNameSearch).not.toHaveBeenCalled()
  }, 10_000)
})
