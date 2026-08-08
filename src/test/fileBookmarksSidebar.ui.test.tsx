import { App as AntdApp } from 'antd'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileBookmarksSidebar } from '#features/file-bookmarks'

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
})
