import { render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FileBookmark } from '#entities/file'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { WorkbenchBookmarkEditorModal } from '../features/workbench-files/ui/WorkbenchBookmarkEditorModal'

const bookmark: FileBookmark = {
  id: 'bookmark-a',
  name: 'Home',
  path: '/root',
  group_id: '',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function modalProps(): ComponentProps<typeof WorkbenchBookmarkEditorModal> {
  return {
    open: true,
    currentPath: '/root',
    bookmark: null,
    groups: [],
    saving: false,
    error: '',
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
  }
}

describe('工作台书签弹窗模式合同', () => {
  it('根据 bookmark 是否存在切换新增和编辑上下文及主操作', async () => {
    const props = modalProps()
    const view = render(<WorkbenchBookmarkEditorModal {...props} />)

    await waitFor(() => {
      expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('root')
    })
    const createContext = document.querySelector('[data-editor-mode="create"]')
    expect(createContext).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeInTheDocument()

    view.rerender(<WorkbenchBookmarkEditorModal {...props} bookmark={bookmark} />)

    await waitFor(() => {
      const editContext = document.querySelector('[data-editor-mode="edit"]')
      expect(editContext).toHaveTextContent('Home')
      expect(editContext).toHaveTextContent('app.edit')
    })
    expect(screen.getByRole('button', { name: 'app.save' })).toBeInTheDocument()
  })
})
