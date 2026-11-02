import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkflowFileBridge, WorkflowFileProgress } from '#common/contracts'
import type { WorkflowGateway, WorkflowExchangeGateway } from '#entities/desktop-workflow'
import { WorkflowWorkspace } from '../WorkflowWorkspace'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => { delete (window as Window & { termous?: unknown }).termous; vi.unstubAllGlobals() })

function setup() {
  vi.stubGlobal('WebSocket', class { close() {} })
  const listeners = new Set<(value: WorkflowFileProgress) => void>()
  const files: WorkflowFileBridge = { run: vi.fn(async () => ({ canceled: true })), cancel: vi.fn(async () => {}),
    onProgress: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  Object.defineProperty(window, 'termous', { configurable: true, value: { workflowFiles: files } })
  const script = { id: 'script', name: '已保存工作流', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
  const gateway = { list: vi.fn(async () => [script]), listRuns: vi.fn(async () => []), eventsURL: () => 'ws://fixture/events',
    ocrDefaults: vi.fn(async () => ({ text_confidence: .5, ocr_max_side: 1600 })),
    get: vi.fn(async () => ({ script, version: { script_id: script.id, number: 1, created_at: '', definition: { schema_version: 2, parameters: [], steps: [] } } })),
  } as unknown as WorkflowGateway
  const exchange: WorkflowExchangeGateway = { inspect: vi.fn(), commit: vi.fn(), release: vi.fn(), asset: vi.fn() }
  const view = render(<StrictMode><ConfigProvider theme={{ token: { motion: false } }}><App>
    <WorkflowWorkspace gateway={gateway} exchangeGateway={exchange} sessions={[]} profiles={[]} onDirtyChange={() => {}} onViewDesktop={() => {}} />
  </App></ConfigProvider></StrictMode>)
  return { ...view, files, listeners }
}

it('StrictMode 挂载后导入仍到达文件桥接，进度订阅不泄漏', async () => {
  const view = setup()
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.exchange.import' }))
    await waitFor(() => expect(view.files.run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'import' })))
    expect(view.listeners.size).toBe(1)
  } finally { view.unmount() }
  expect(view.listeners.size).toBe(0)
})

it('StrictMode 中从已保存流程选择导出格式后请求原生保存路径', async () => {
  const view = setup()
  try {
    fireEvent.click(await screen.findByRole('button', { name: /已保存工作流/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.moreActions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'desktopWorkflow.exchange.export' }))
    fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.exchange.export' }))
    await waitFor(() => expect(view.files.run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'export', script_id: 'script', version: 1, layout: 'zip' })))
  } finally { view.unmount() }
})
