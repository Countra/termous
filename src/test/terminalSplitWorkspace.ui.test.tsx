import { act, render, screen } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '#entities/session'
import {
  TerminalSplitWorkspace,
  type TerminalSplitWorkspaceHandle,
} from '../features/terminal/ui/TerminalSplitWorkspace'

type PanelLayout = Record<string, number>

interface LayoutChangedMeta {
  isUserInteraction: boolean
}

const resizePanelMocks = vi.hoisted(() => ({
  onLayoutChange: undefined as ((layout: PanelLayout) => void) | undefined,
  onLayoutChanged: undefined as ((layout: PanelLayout, meta: LayoutChangedMeta) => void) | undefined,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-resizable-panels', () => ({
  Group: ({
    children,
    onLayoutChange,
    onLayoutChanged,
  }: {
    children?: ReactNode
    onLayoutChange?: (layout: PanelLayout) => void
    onLayoutChanged?: (layout: PanelLayout, meta: LayoutChangedMeta) => void
  }) => {
    resizePanelMocks.onLayoutChange = onLayoutChange
    resizePanelMocks.onLayoutChanged = onLayoutChanged
    return <div data-testid="resizable-group">{children}</div>
  },
  Panel: ({
    children,
    defaultSize,
    id,
    minSize,
  }: {
    children?: ReactNode
    defaultSize?: number | string
    id: string
    minSize?: number | string
  }) => (
    <div
      data-testid={`resizable-panel-${id}`}
      data-default-size={defaultSize}
      data-min-size={minSize}
    >
      {children}
    </div>
  ),
  Separator: ({ id }: { id: string }) => <div data-testid={id} />,
}))

vi.mock('../features/terminal/ui/TerminalPaneViewport', () => ({
  TerminalPaneViewport: ({ paneId }: { paneId: string }) => (
    <div data-testid={`terminal-pane-${paneId}`} />
  ),
}))

const sessions: Session[] = [
  {
    id: 'session-a',
    kind: 'ssh',
    status: 'connected',
    started_at: '2026-08-13T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
  },
  {
    id: 'session-b',
    kind: 'ssh',
    status: 'connected',
    started_at: '2026-08-13T00:00:01Z',
    pty_cols: 120,
    pty_rows: 32,
  },
]

function renderSplitWorkspace() {
  const ref = createRef<TerminalSplitWorkspaceHandle>()
  render(
    <TerminalSplitWorkspace
      ref={ref}
      sessions={sessions}
      activeSession={sessions[0]}
      workspaceActive
      themeMode="dark"
      placeholder="terminal"
      onSelectSession={() => undefined}
    />,
  )

  act(() => {
    expect(ref.current?.splitSessionFromMenu('session-b')).toBe('applied')
  })

  return {
    firstPanel: screen.getByTestId('resizable-panel-terminal-pane-0'),
    secondPanel: screen.getByTestId('resizable-panel-terminal-pane-1'),
  }
}

describe('终端分屏尺寸写回', () => {
  beforeEach(() => {
    resizePanelMocks.onLayoutChange = undefined
    resizePanelMocks.onLayoutChanged = undefined
  })

  it('仅绑定拖动结束回调并使用百分比尺寸', () => {
    const { firstPanel, secondPanel } = renderSplitWorkspace()

    expect(resizePanelMocks.onLayoutChange).toBeUndefined()
    expect(resizePanelMocks.onLayoutChanged).toEqual(expect.any(Function))
    expect(firstPanel).toHaveAttribute('data-default-size', '50%')
    expect(secondPanel).toHaveAttribute('data-default-size', '50%')
    expect(firstPanel).toHaveAttribute('data-min-size', '18%')
    expect(secondPanel).toHaveAttribute('data-min-size', '18%')
  })

  it('忽略非用户布局变化，仅在用户完成拖动后写回尺寸', () => {
    renderSplitWorkspace()
    const onLayoutChanged = resizePanelMocks.onLayoutChanged
    expect(onLayoutChanged).toEqual(expect.any(Function))

    act(() => {
      onLayoutChanged?.(
        { 'terminal-pane-0': 42, 'terminal-pane-1': 58 },
        { isUserInteraction: false },
      )
    })
    expect(screen.getByTestId('resizable-panel-terminal-pane-0')).toHaveAttribute('data-default-size', '50%')
    expect(screen.getByTestId('resizable-panel-terminal-pane-1')).toHaveAttribute('data-default-size', '50%')

    act(() => {
      onLayoutChanged?.(
        { 'terminal-pane-0': 42, 'terminal-pane-1': 58 },
        { isUserInteraction: true },
      )
    })
    expect(screen.getByTestId('resizable-panel-terminal-pane-0')).toHaveAttribute('data-default-size', '42%')
    const secondSize = screen.getByTestId('resizable-panel-terminal-pane-1').getAttribute('data-default-size')
    expect(secondSize).toMatch(/%$/)
    expect(Number.parseFloat(secondSize ?? '')).toBeCloseTo(58)
  })
})
