import { App as AntdApp } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { LocalPathMapping } from '#entities/file'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { LocalDownloadMappingPane } from '../features/local-download/ui/LocalDownloadMappingPane'

const mapping: LocalPathMapping = {
  id: 'mapping-a',
  name: 'Downloads',
  path: 'D:\\Downloads',
  sort_order: 0,
  available: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function mappingPaneProps(): ComponentProps<typeof LocalDownloadMappingPane> {
  return {
    open: true,
    mappings: [mapping],
    selectedMappingId: mapping.id,
    drop: {
      activeDropTarget: '',
      busyDropTarget: '',
      nativeFilesRejected: false,
      onRootDragEnterCapture: vi.fn(),
      onRootDragOverCapture: vi.fn(),
      onRootDropCapture: vi.fn(),
      onRootDragLeave: vi.fn(),
      onRootDragOver: vi.fn(),
      onRootDrop: vi.fn(),
      onTargetDragOver: vi.fn(),
      onTargetDragLeave: vi.fn(),
      onTargetDrop: vi.fn(),
    },
    onSelectMapping: vi.fn(),
    onCreateMapping: vi.fn(),
    onUpdateMapping: vi.fn(),
    onDeleteMapping: vi.fn(),
    onReorderMappings: vi.fn(),
    onActionError: vi.fn(),
  }
}

describe('本地目录映射编辑模式合同', () => {
  it('从新增和编辑入口呈现紧凑模式标识及对应主操作', async () => {
    const user = userEvent.setup()
    const createView = render(
      <AntdApp>
        <LocalDownloadMappingPane {...mappingPaneProps()} />
      </AntdApp>,
    )

    await user.click(screen.getByRole('button', { name: 'files.addLocalMapping' }))
    const createIndicator = document.querySelector('[data-editor-mode="create"]')
    expect(createIndicator).toHaveTextContent('app.add')
    expect(createIndicator).toHaveAttribute('data-editor-size', 'compact')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeInTheDocument()

    createView.unmount()
    render(
      <AntdApp>
        <LocalDownloadMappingPane {...mappingPaneProps()} />
      </AntdApp>,
    )

    await user.click(screen.getByRole('button', { name: 'app.edit' }))
    const editIndicator = document.querySelector('[data-editor-mode="edit"]')
    expect(editIndicator).toHaveTextContent('app.edit')
    expect(editIndicator).toHaveAttribute('data-editor-size', 'compact')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeInTheDocument()
  })
})
