import { App as AntdApp } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CrontabSnapshot } from '#entities/crontab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { CrontabRawEditorModal } from './CrontabRawEditorModal'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const snapshot: CrontabSnapshot = {
  session_id: 'session-a',
  username: 'deploy',
  exists: true,
  revision: 'revision-a',
  jobs: [],
  unmanaged_line_count: 0,
  warnings: [],
  collected_at: '2026-08-11T00:00:00Z',
  content: '0 2 * * * /usr/bin/true\n',
}

describe('Crontab 原文编辑合同', () => {
  it('重新加载期间锁定编辑器和关闭操作并为编辑区提供名称', async () => {
    const pending = deferred<CrontabSnapshot | null>()
    render(
      <AntdApp>
        <CrontabRawEditorModal
          open
          snapshot={snapshot}
          theme="dark"
          writable
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onReload={() => pending.promise}
        />
      </AntdApp>,
    )
    await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull())
    const editor = document.querySelector('.cm-content')
    expect(editor).toHaveAttribute('aria-label', 'workbench.crontab.raw.editorLabel')

    fireEvent.click(screen.getByRole('button', { name: 'workbench.crontab.raw.reload' }))
    await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'false'))
    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()

    await act(async () => {
      pending.resolve({ ...snapshot, revision: 'revision-b' })
      await pending.promise
    })
    await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'true'))
  })

  it('能力降级后保留原文草稿并立即切换为只读', async () => {
    const view = render(
      <AntdApp>
        <CrontabRawEditorModal
          open
          snapshot={snapshot}
          theme="dark"
          writable
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onReload={vi.fn()}
        />
      </AntdApp>,
    )
    await waitFor(() => expect(document.querySelector('.cm-content')).toHaveAttribute(
      'contenteditable',
      'true',
    ))

    view.rerender(
      <AntdApp>
        <CrontabRawEditorModal
          open
          snapshot={snapshot}
          theme="dark"
          writable={false}
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onReload={vi.fn()}
        />
      </AntdApp>,
    )

    await waitFor(() => expect(document.querySelector('.cm-content')).toHaveAttribute(
      'contenteditable',
      'false',
    ))
    expect(screen.getByRole('button', { name: 'workbench.crontab.raw.save' })).toBeDisabled()
    expect(screen.getByText('workbench.crontab.readOnlyHint')).toBeInTheDocument()
  })
})
