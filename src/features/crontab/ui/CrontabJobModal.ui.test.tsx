import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CrontabJob } from '#entities/crontab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { CrontabJobModal } from './CrontabJobModal'

const existingJob: CrontabJob = {
  id: 'job-a',
  line_number: 1,
  enabled: false,
  schedule_kind: 'macro',
  expression: '@reboot',
  command: '/usr/bin/startup',
  editable: true,
  warnings: [],
}

describe('Crontab 任务编辑器', () => {
  it('新增模式使用默认计划并提交结构化任务', () => {
    const onSubmit = vi.fn()
    render(
      <CrontabJobModal
        open
        job={null}
        writable
        busy={false}
        blocked={false}
        blockMessage=""
        reloading={false}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('app.add')
    const submitButton = screen.getByRole('button', { name: 'app.create' })
    expect(submitButton).toBeDisabled()

    const commandInput = document.querySelector('#crontab-command')
    expect(commandInput).toBeInstanceOf(HTMLTextAreaElement)
    fireEvent.change(commandInput as HTMLTextAreaElement, { target: { value: '/usr/bin/true' } })

    expect(submitButton).toBeEnabled()
    fireEvent.click(submitButton)
    expect(onSubmit).toHaveBeenCalledWith({
      schedule: '* * * * *',
      command: '/usr/bin/true',
      enabled: true,
    })
  })

  it('编辑模式保留宏、命令和停用状态', () => {
    const onSubmit = vi.fn()
    render(
      <CrontabJobModal
        open
        job={existingJob}
        writable
        busy={false}
        blocked={false}
        blockMessage=""
        reloading={false}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent('app.edit')
    expect(screen.getByText('@reboot')).toBeInTheDocument()
    expect(document.querySelector('#crontab-command')).toHaveValue('/usr/bin/startup')

    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(onSubmit).toHaveBeenCalledWith({
      schedule: '@reboot',
      command: '/usr/bin/startup',
      enabled: false,
    })
  })

  it('冲突锁定保存但保留草稿并提供重新加载入口', () => {
    const onReload = vi.fn()
    const view = render(
      <CrontabJobModal
        open
        job={existingJob}
        writable
        busy={false}
        blocked={false}
        blockMessage=""
        reloading={false}
        onCancel={vi.fn()}
        onReload={onReload}
        onSubmit={vi.fn()}
      />,
    )
    const command = document.querySelector('#crontab-command') as HTMLTextAreaElement
    fireEvent.change(command, { target: { value: '/usr/bin/changed' } })

    view.rerender(
      <CrontabJobModal
        open
        job={existingJob}
        writable
        busy={false}
        blocked
        blockMessage="conflict"
        reloading={false}
        onCancel={vi.fn()}
        onReload={onReload}
        onSubmit={vi.fn()}
      />,
    )

    expect(command).toHaveValue('/usr/bin/changed')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'workbench.crontab.editor.reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('能力降级后立即锁定字段和保存操作', () => {
    const view = render(
      <CrontabJobModal
        open
        job={existingJob}
        writable
        busy={false}
        blocked={false}
        blockMessage=""
        reloading={false}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    view.rerender(
      <CrontabJobModal
        open
        job={existingJob}
        writable={false}
        busy={false}
        blocked={false}
        blockMessage=""
        reloading={false}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(document.querySelector('#crontab-command')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    expect(screen.getByText('workbench.crontab.readOnlyHint')).toBeInTheDocument()
  })

  it('重新加载期间禁止通过取消按钮或关闭按钮退出', () => {
    const onCancel = vi.fn()
    render(
      <CrontabJobModal
        open
        job={existingJob}
        writable
        busy={false}
        blocked
        blockMessage="conflict"
        reloading
        onCancel={onCancel}
        onReload={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
    expect(document.querySelector('.ant-modal-close')).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
