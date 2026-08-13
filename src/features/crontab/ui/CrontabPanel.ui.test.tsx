import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CrontabCapability, CrontabJob, CrontabSnapshot } from '#entities/crontab'
import { TermousApiError } from '#shared/api'
import type { CrontabGateway, CrontabSessionContext } from '../model/contracts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

const job: CrontabJob = {
  id: 'job-old',
  line_number: 4,
  enabled: true,
  schedule_kind: 'standard',
  expression: '0 2 * * *',
  command: '/usr/bin/backup',
  editable: true,
  warnings: [],
}

const snapshot: CrontabSnapshot = {
  session_id: 'session-a',
  username: 'deploy',
  exists: true,
  revision: 'revision-a',
  jobs: [job],
  unmanaged_line_count: 0,
  warnings: [],
  collected_at: '2026-08-11T00:00:00Z',
}

function renderPanel(api: CrontabGateway, activeSession: CrontabSessionContext | null = session) {
  return render(
    <AntdApp>
      <CrontabPanel api={api} session={activeSession} enabled theme="dark" />
    </AntdApp>,
  )
}

describe('Crontab 面板写入恢复合同', () => {
  it('编辑冲突后保留草稿，安全重载后使用新 Job ID 继续保存', async () => {
    const reloadedJob = { ...job, id: 'job-new' }
    const reloadedSnapshot = {
      ...snapshot,
      revision: 'revision-b',
      jobs: [reloadedJob],
    }
    const savedSnapshot = {
      ...reloadedSnapshot,
      revision: 'revision-c',
      jobs: [{ ...reloadedJob, command: '/usr/bin/draft' }],
    }
    const updateSessionCrontabJob = vi.fn<CrontabGateway['updateSessionCrontabJob']>()
      .mockRejectedValueOnce(new TermousApiError('conflict', 'CRONTAB_CONFLICT', 409))
      .mockResolvedValueOnce(savedSnapshot)
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce(reloadedSnapshot),
      updateSessionCrontabJob,
    } as unknown as CrontabGateway
    renderPanel(api)

    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.editJob' }))
    const command = document.querySelector('#crontab-command') as HTMLTextAreaElement
    fireEvent.change(command, { target: { value: '/usr/bin/draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))

    const reload = await screen.findByRole('button', { name: 'workbench.crontab.editor.reload' })
    expect(command).toHaveValue('/usr/bin/draft')
    expect(screen.getByRole('button', { name: /app\.save/u })).toBeDisabled()
    fireEvent.click(reload)
    await waitFor(() => expect(screen.queryByRole('button', {
      name: 'workbench.crontab.editor.reload',
    })).not.toBeInTheDocument())
    expect(command).toHaveValue('/usr/bin/draft')

    fireEvent.click(screen.getByRole('button', { name: /app\.save/u }))
    await waitFor(() => expect(updateSessionCrontabJob).toHaveBeenCalledTimes(2))
    expect(updateSessionCrontabJob.mock.calls[0][1]).toBe('job-old')
    expect(updateSessionCrontabJob.mock.calls[1][1]).toBe('job-new')
    expect(updateSessionCrontabJob.mock.calls[1][2]).toMatchObject({
      expected_revision: 'revision-b',
      command: '/usr/bin/draft',
    })
  })

  it('切换会话时同步隐藏旧会话的结构化编辑器', async () => {
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
    } as unknown as CrontabGateway
    const view = renderPanel(api)
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.editJob' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    view.rerender(
      <AntdApp>
        <CrontabPanel
          api={api}
          session={{ ...session, id: 'session-b' }}
          enabled
          theme="dark"
        />
      </AntdApp>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('新增结果不确定时刷新后仍禁止重复提交', async () => {
    const createdJob = {
      ...job,
      id: 'job-created',
      command: '/usr/bin/new-task',
    }
    const latestSnapshot = {
      ...snapshot,
      revision: 'revision-b',
      jobs: [job, createdJob],
    }
    const createSessionCrontabJob = vi.fn<CrontabGateway['createSessionCrontabJob']>()
      .mockRejectedValue(new TermousApiError('uncertain', 'CRONTAB_WRITE_UNCERTAIN', 502))
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce(latestSnapshot),
      createSessionCrontabJob,
    } as unknown as CrontabGateway
    renderPanel(api)

    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.create' }))
    const command = document.querySelector('#crontab-command') as HTMLTextAreaElement
    fireEvent.change(command, { target: { value: '/usr/bin/new-task' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.create' }))

    const reload = await screen.findByRole('button', { name: 'workbench.crontab.editor.reload' })
    fireEvent.click(reload)
    await screen.findByText('workbench.crontab.editor.uncertainCreate')

    const submit = screen.getByRole('button', { name: /app\.create/u })
    expect(command).toHaveValue('/usr/bin/new-task')
    expect(submit).toBeDisabled()
    expect(screen.queryByRole('button', {
      name: 'workbench.crontab.editor.reload',
    })).not.toBeInTheDocument()
    fireEvent.click(submit)
    expect(createSessionCrontabJob).toHaveBeenCalledTimes(1)
  })

  it('新增 revision 冲突刷新后允许使用新 revision 重试', async () => {
    const reloadedSnapshot = { ...snapshot, revision: 'revision-b' }
    const savedSnapshot = { ...snapshot, revision: 'revision-c' }
    const createSessionCrontabJob = vi.fn<CrontabGateway['createSessionCrontabJob']>()
      .mockRejectedValueOnce(new TermousApiError('conflict', 'CRONTAB_CONFLICT', 409))
      .mockResolvedValueOnce(savedSnapshot)
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce(reloadedSnapshot),
      createSessionCrontabJob,
    } as unknown as CrontabGateway
    renderPanel(api)

    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.create' }))
    const command = document.querySelector('#crontab-command') as HTMLTextAreaElement
    fireEvent.change(command, { target: { value: '/usr/bin/new-task' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.create' }))
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.editor.reload' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /app\.create/u })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /app\.create/u }))
    await waitFor(() => expect(createSessionCrontabJob).toHaveBeenCalledTimes(2))
    expect(createSessionCrontabJob.mock.calls[1][1]).toMatchObject({
      expected_revision: 'revision-b',
      command: '/usr/bin/new-task',
    })
  })

  it('恢复刷新发现能力降级时立即锁定结构化草稿', async () => {
    const readOnlyCapability = {
      ...capability,
      status: 'read_only' as const,
      writable: false,
    }
    const updateSessionCrontabJob = vi.fn<CrontabGateway['updateSessionCrontabJob']>()
      .mockRejectedValue(new TermousApiError('conflict', 'CRONTAB_CONFLICT', 409))
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>()
        .mockResolvedValueOnce(capability)
        .mockResolvedValueOnce(readOnlyCapability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
      updateSessionCrontabJob,
    } as unknown as CrontabGateway
    renderPanel(api)

    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.editJob' }))
    const command = document.querySelector('#crontab-command') as HTMLTextAreaElement
    fireEvent.change(command, { target: { value: '/usr/bin/draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'workbench.crontab.editor.reload' }))

    await waitFor(() => expect(command).toBeDisabled())
    expect(command).toHaveValue('/usr/bin/draft')
    expect(screen.getByRole('button', { name: /app\.save/u })).toBeDisabled()
    expect(screen.getAllByText('workbench.crontab.readOnlyHint')).not.toHaveLength(0)
    expect(updateSessionCrontabJob).toHaveBeenCalledTimes(1)
  })
})
