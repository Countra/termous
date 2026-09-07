import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { LocalPathMapping } from '#entities/file'
import { createLocalDirectoryViewState } from '../features/local-download/model/localDownloadWorkspaceState'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { LocalDownloadBrowserPane } from '../features/local-download/ui/LocalDownloadBrowserPane'

const mapping: LocalPathMapping = {
  id: 'mapping-a',
  name: 'Downloads',
  path: 'D:\\Downloads',
  sort_order: 0,
  available: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function browserPaneProps(): ComponentProps<typeof LocalDownloadBrowserPane> {
  return {
    mapping: null,
    state: null,
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
    onNavigate: vi.fn(),
    onNavigateParent: vi.fn(),
    onRefresh: vi.fn(),
    onRetry: vi.fn(),
    onActionError: vi.fn(),
  }
}

describe('本地下载目录浏览区布局合同', () => {
  it('没有目录映射时不渲染空面包屑行', () => {
    render(<LocalDownloadBrowserPane {...browserPaneProps()} />)

    const browser = screen.getByRole('region', { name: 'files.downloadDestinationFolders' })
    expect(browser).not.toHaveClass('has-breadcrumbs')
    expect(screen.queryByRole('navigation', { name: 'files.downloadDestinationCurrent' })).not.toBeInTheDocument()
    expect(screen.getByText('files.downloadDestinationNoMappings')).toBeInTheDocument()
  })

  it('存在有效目录路径时保留面包屑行和当前路径标识', () => {
    const state = {
      ...createLocalDirectoryViewState(mapping),
      committedPath: 'D:\\Downloads\\projects',
      hasLoaded: true,
    }
    render(<LocalDownloadBrowserPane {...browserPaneProps()} mapping={mapping} state={state} />)

    const browser = screen.getByRole('region', { name: 'files.downloadDestinationFolders' })
    const breadcrumbs = screen.getByRole('navigation', { name: 'files.downloadDestinationCurrent' })
    expect(browser).toHaveClass('has-breadcrumbs')
    expect(within(breadcrumbs).getByRole('button', { name: 'Downloads' })).not.toHaveAttribute('aria-current')
    expect(within(breadcrumbs).getByRole('button', { name: 'projects' })).toHaveAttribute('aria-current', 'location')
  })
})
