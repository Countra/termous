import { App as AntdApp } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CrontabCapability, CrontabJob, CrontabSnapshot } from '#entities/crontab'
import { TermousApiError } from '#shared/api'
import type { CrontabGateway, CrontabSessionContext } from '../model/contracts'

const useSessionCrontabMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../model/useSessionCrontab', () => ({
  useSessionCrontab: useSessionCrontabMock,
}))

import { CrontabPanel } from './CrontabPanel'

const session: CrontabSessionContext = {
  id: 'session-a',
  kind: 'ssh',
  status: 'connected',
}

const capability: CrontabCapability = {
  status: 'ready',
  available: true,
  readable: true,
  writable: true,
  username: 'deploy',
  warnings: [],
  checked_at: '2026-08-11T00:00:00Z',
}

function createJob(id: string, command: string): CrontabJob {
  return {
    id,
    line_number: 1,
    enabled: true,
    schedule_kind: 'standard',
    expression: '0 2 * * *',
    command,
    editable: true,
    warnings: [],
  }
}

function createSnapshot(revision: string, job: CrontabJob): CrontabSnapshot {
  return {
    session_id: session.id,
    username: 'deploy',
    exists: true,
    revision,
    jobs: [job],
    unmanaged_line_count: 0,
    warnings: [],
    collected_at: '2026-08-11T00:00:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('Crontab 结构化编辑器 generation 隔离', () => {
  it('失活编辑器的迟到重载不会改写随后打开的编辑目标', async () => {
    const jobA = createJob('job-a', '/usr/bin/a')
    const jobB = createJob('job-b', '/usr/bin/b')
    const snapshotA = createSnapshot('revision-a', jobA)
    const snapshotB = createSnapshot('revision-b', jobB)
    const pendingReload = deferred<CrontabSnapshot>()
    const updateJob = vi.fn()
      .mockRejectedValueOnce(new TermousApiError('conflict', 'CRONTAB_CONFLICT', 409))
      .mockResolvedValueOnce(snapshotB)
    const runtime = {
      supported: true,
      capability,
      snapshot: snapshotA,
      loading: false,
      mutation: null,
      errorCode: '',
      errorMessage: '',
      refresh: vi.fn(() => pendingReload.promise),
      loadSource: vi.fn(),
      createJob: vi.fn(),
      updateJob,
      deleteJob: vi.fn(),
      replaceContent: vi.fn(),
    }
    useSessionCrontabMock.mockImplementation(() => runtime)
    const api = {} as CrontabGateway
    const view = render(
      <AntdApp>
        <CrontabPanel api={api} session={session} enabled theme="dark" />
      </AntdApp>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workbench.crontab.editJob' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.editor.reload' }))

    view.rerender(
      <AntdApp>
        <CrontabPanel api={api} session={session} enabled={false} theme="dark" />
      </AntdApp>,
    )
    runtime.snapshot = snapshotB
    view.rerender(
      <AntdApp>
        <CrontabPanel api={api} session={session} enabled theme="dark" />
      </AntdApp>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'workbench.crontab.editJob' }))
    await waitFor(() => expect(document.querySelector('#crontab-command')).toHaveValue('/usr/bin/b'))

    await act(async () => {
      pendingReload.resolve(snapshotA)
      await pendingReload.promise
    })

    expect(document.querySelector('#crontab-command')).toHaveValue('/usr/bin/b')
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(updateJob).toHaveBeenCalledTimes(2))
    expect(updateJob.mock.calls.map((call) => call[0])).toEqual(['job-a', 'job-b'])
  })
})
