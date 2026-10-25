import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { editorLayout } from '../../model/editorLayout'
import type { WorkflowPresentation } from '../../model/workspace/types'
import { WorkflowEditorLayout } from './WorkflowEditorLayout'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('编辑器分栏', () => {
  it('适配窄窗口但不覆盖展开宽度，始终为中央画面留出空间', () => {
    const preferred = { chainWidth: 420, detailsWidth: 480 }
    for (const width of [960, 1024, 1200, 1600]) {
      const fit = editorLayout(width, preferred, false, true)
      expect(fit.available - fit.chainWidth - fit.detailsWidth).toBeGreaterThanOrEqual(319.99)
      expect(fit.chainWidth).toBeGreaterThanOrEqual(220)
      expect(fit.detailsWidth).toBeGreaterThanOrEqual(260)
      expect(Object.values(fit.sizes).reduce((sum, n) => sum + n, 0)).toBeCloseTo(100)
    }
    expect(editorLayout(800, preferred, false, true)).toMatchObject({ compact: true, chainWidth: 0, detailsWidth: 0 })
    expect(editorLayout(500, preferred, false, true)).toMatchObject({ compact: true, chainWidth: 0, detailsWidth: 0 })
    expect(editorLayout(1600, preferred, true, false)).toMatchObject({ chainWidth: 0, detailsWidth: 0 })
    expect(editorLayout(1600, preferred, false, true)).toMatchObject(preferred)
    expect(editorLayout(500, preferred, false, true, 'details').sizes).toEqual({ chain: 0, canvas: 0, details: 100 })
    expect(editorLayout(500, preferred, false, true, 'chain').sizes).toEqual({ chain: 100, canvas: 0, details: 0 })
  })

  it('收起完全释放空间，窄窗原位切换不重建画布或改变宽窗布局偏好', async () => {
    const mounted = vi.fn(), disposed = vi.fn(), patch = vi.fn()
    function Canvas() { useEffect(() => { mounted(); return disposed }, []); return <div>canvas</div> }
    function Fixture({ width }: { width: number }) {
      const [presentation, setPresentation] = useState<WorkflowPresentation>({ propertiesVisible: true, chainCollapsed: false, editorPanels: { chainWidth: 330, detailsWidth: 362 }, queries: { scripts: '', runs: '' }, runFilter: 'all' })
      return <ConfigProvider theme={{ token: { motion: false } }}><WorkflowEditorLayout width={width} busy={false} presentation={presentation} onPresentation={value => { patch(value); setPresentation(p => ({ ...p, ...value })) }}
        chain={(close, select) => <div><button onClick={close}>collapse chain</button><button onClick={select}>choose step</button></div>}
        properties={<input aria-label="property" defaultValue="step" />}><Canvas /></WorkflowEditorLayout></ConfigProvider>
    }
    const view = render(<Fixture width={1400} />)
    fireEvent.click(screen.getByRole('button', { name: 'collapse chain' }))
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.collapseProperties' }))
    expect(screen.queryByRole('textbox', { name: 'property' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.executionChain' }))
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.properties' }))
    expect(screen.getByRole('textbox', { name: 'property' })).toBeVisible()
    patch.mockClear()
    view.rerender(<Fixture width={500} />)
    fireEvent.click(screen.getByRole('radio', { name: 'desktopWorkflow.executionChain' }))
    fireEvent.click(screen.getByRole('button', { name: 'choose step' }))
    expect(screen.getByRole('radio', { name: 'desktopWorkflow.editorCanvas' })).toBeChecked()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'desktopWorkflow.properties' }))
    expect(await screen.findByRole('textbox', { name: 'property' })).toBeVisible()
    view.rerender(<Fixture width={1400} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(patch).not.toHaveBeenCalled()
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(disposed).not.toHaveBeenCalled()
    view.unmount()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})
