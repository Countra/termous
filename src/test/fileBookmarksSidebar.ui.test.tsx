import { App as AntdApp } from 'antd'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileBookmark } from '#entities/file'
import { FileBookmarksSidebar } from '#features/file-bookmarks'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const originalMatchMedia = window.matchMedia

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
})

describe('文件书签侧栏浮层合同', () => {
  it('Escape 只受本侧栏打开的浮层拦截', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: query === '(max-width: 699px)',
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })
    const onRequestClose = vi.fn()
    render(
      <AntdApp>
        <FileBookmarksSidebar
          bookmarks={[]}
          groups={[]}
          currentPath="/"
          connected={false}
          open
          mutationPending={false}
          onNavigate={vi.fn()}
          onCreateBookmark={vi.fn()}
          onUpdateBookmark={vi.fn()}
          onDeleteBookmark={vi.fn()}
          onReorderBookmarks={vi.fn()}
          onCreateGroup={vi.fn()}
          onUpdateGroup={vi.fn()}
          onDeleteGroup={vi.fn()}
          onReorderGroups={vi.fn()}
          onRequestClose={onRequestClose}
        />
      </AntdApp>,
    )

    const unrelatedPopup = document.createElement('div')
    unrelatedPopup.className = 'ant-dropdown'
    document.body.append(unrelatedPopup)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onRequestClose).toHaveBeenCalledWith('dismiss')
    unrelatedPopup.remove()

    onRequestClose.mockClear()
    const ownedPopup = document.createElement('div')
    ownedPopup.className = 'ant-dropdown'
    const marker = document.createElement('div')
    marker.dataset.filesBookmarksFloatingLayer = ''
    ownedPopup.append(marker)
    document.body.append(ownedPopup)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onRequestClose).not.toHaveBeenCalled()
    ownedPopup.remove()
  })

  it('书签编辑器从入口明确切换新建和编辑模式', async () => {
    const user = userEvent.setup()
    const commonProps = {
      groups: [],
      currentPath: '/current',
      connected: false,
      open: true,
      mutationPending: false,
      onNavigate: vi.fn(),
      onCreateBookmark: vi.fn(),
      onUpdateBookmark: vi.fn(),
      onDeleteBookmark: vi.fn(),
      onReorderBookmarks: vi.fn(),
      onCreateGroup: vi.fn(),
      onUpdateGroup: vi.fn(),
      onDeleteGroup: vi.fn(),
      onReorderGroups: vi.fn(),
      onRequestClose: vi.fn(),
    }
    const createView = render(
      <AntdApp>
        <FileBookmarksSidebar {...commonProps} bookmarks={[]} />
      </AntdApp>,
    )

    await user.click(screen.getByRole('button', { name: 'files.addBookmark' }))
    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeInTheDocument()

    createView.unmount()

    const bookmark: FileBookmark = {
      id: 'bookmark-a',
      name: 'Home',
      path: '/root',
      group_id: '',
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    render(
      <AntdApp>
        <FileBookmarksSidebar {...commonProps} bookmarks={[bookmark]} />
      </AntdApp>,
    )

    await user.click(screen.getByRole('button', { name: 'files.editBookmark' }))
    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent('app.edit')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeInTheDocument()
  })
})
