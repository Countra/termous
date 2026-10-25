import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { StrictMode, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkflowState, WorkflowSurfaceModel, WorkflowPresentation, WorkflowMediaGateway } from '../../model/workspace/types'
import { WorkflowAnalysis } from './WorkflowAnalysis'
import { result, setup } from './analysisTestFixture'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => vi.restoreAllMocks())

function harness() {
  const fixture = setup()
  const applied = vi.fn(); const changed = vi.fn()
  function View({ gateway = fixture.gateway }: { gateway?: WorkflowMediaGateway }) {
    const [state, setState] = useState<WorkflowState>({ dirty: false, busy: false, view: 'scripts', selected: 'click',
      draft: { editingID: 'draft', name: 'draft', description: '', tags: [], definition: { schema_version: 2, parameters: [], steps: [fixture.props.step] } },
      presentation: { propertiesVisible: true, queries: { scripts: '', runs: '' }, runFilter: 'all' } })
    const model = { execution: { report: { busy: false, loading: false } }, scripts: [], runs: [], loading: false, state, target: fixture.props.target, environment: { sessions: fixture.props.sessions, profiles: [] },
      actions: { presentation: (patch: Partial<WorkflowPresentation>) => setState(value => ({ ...value, presentation: { ...value.presentation, ...patch } })), change: changed } as unknown as WorkflowSurfaceModel['actions'] } as WorkflowSurfaceModel
    return <StrictMode><ConfigProvider theme={{ token: { motion: false } }}><App><WorkflowAnalysis model={model} gateway={gateway}
      slot="target" active guided={false} onMediaTask={() => {}} onApplied={applied} /></App></ConfigProvider></StrictMode>
  }
  return { ...fixture, View, applied, changed }
}
async function analyze() {
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.title' }))
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.analyze' }))
  fireEvent.click(await screen.findByRole('button', { name: /Connect/ }, { timeout: 5000 }))
}

it('来源保留主机名和原始 Profile 名称，不改写 default', () => {
  const { View } = harness()
  render(<View />)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.title' }))
  expect(screen.getByText('win-4090 · default')).toBeInTheDocument()
})

it('StrictMode 中提交独立预览，应用确认后才关闭并交接原图', async () => {
  const { View, gateway, changed, applied } = harness()
  let acknowledge!: () => void
  changed.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve }))
  render(<View />)
  await analyze()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.usePoint' }))
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(changed.mock.calls[0][0].definition.steps[0].target).toMatchObject({ kind: 'point', x: 60, y: 40, reference_width: 800, reference_height: 400 })
  expect(applied).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => acknowledge())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(applied).toHaveBeenCalledWith(expect.objectContaining({ editingID: 'draft', stepID: 'click', snapshot: expect.objectContaining({ blob: expect.any(Blob) }) }))
  expect(gateway.validateAnalysisAction).toHaveBeenCalledTimes(2)
  expect(gateway.capture).not.toHaveBeenCalled()
})

it('应用校验失败保持弹层和草稿，重复点击只启动一次应用', async () => {
  const { View, gateway, changed, applied } = harness()
  let reject!: (reason: Error) => void
  vi.mocked(gateway.validateAnalysisAction).mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  render(<View />)
  await analyze()
  const button = screen.getByRole('button', { name: 'desktopWorkflow.analysis.usePoint' })
  fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(gateway.validateAnalysisAction).toHaveBeenCalledOnce())
  await act(async () => reject(new Error('expired preview')))
  expect(await screen.findByText('expired preview')).toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled(); expect(applied).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('关闭后恢复最近结果但不保留图片，重复开关释放所有 Blob URL', async () => {
  const { View, gateway } = harness()
  const view = render(<View />)
  await analyze()
  // 组件测试检查逐次释放；真实 Electron 验收另覆盖连续 50 次开关。
  for (let index = 0; index < 5; index++) {
    await screen.findByAltText('analysisCenter.originalImage')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(vi.mocked(URL.createObjectURL).mock.calls.length)
    if (index < 4) fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.title' }))
  }
  view.unmount()
  await waitFor(() => expect(gateway.closePreview).toHaveBeenCalledOnce())
  expect(gateway.cancelAnalysis).not.toHaveBeenCalled()
  expect(gateway.submitAnalysis).toHaveBeenCalledOnce()
})

it('切换观察网关后旧提交回执不能覆盖新会话，旧预览仍正常释放', async () => {
  const { View, gateway } = harness()
  let finish!: (record: ReturnType<typeof result>) => void
  vi.mocked(gateway.submitAnalysis).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<View />)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.title' }))
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.analyze' }))
  await waitFor(() => expect(gateway.submitAnalysis).toHaveBeenCalledOnce())
  const next = { ...gateway, getAnalysis: vi.fn().mockResolvedValue(result()) }
  view.rerender(<View gateway={next} />)
  await act(async () => finish(result()))
  expect(next.getAnalysis).not.toHaveBeenCalled()
  await waitFor(() => expect(gateway.closePreview).toHaveBeenCalledOnce())
  expect(gateway.cancelAnalysis).not.toHaveBeenCalled()
})

it('原图读取失败只重试读取，不重新提交分析', async () => {
  const { View, gateway } = harness()
  vi.mocked(gateway.analysisImage).mockRejectedValueOnce(new Error('temporary'))
  render(<View />)
  await analyze()
  fireEvent.click(await screen.findByRole('button', { name: 'app.retry' }))
  await screen.findByAltText('analysisCenter.originalImage')
  expect(gateway.submitAnalysis).toHaveBeenCalledOnce()
  expect(gateway.analysisImage).toHaveBeenCalledTimes(2)
})

it('删除回执只清理被删除记录，不清空等待期间切换的历史记录', async () => {
  const { View, gateway } = harness()
  const other = { ...result(), id: 'other', source: { kind: 'analysis' as const, id: 'parent', name: 'Another desktop' } }
  vi.mocked(gateway.getAnalysis).mockImplementation(async id => id === 'other' ? other : result())
  vi.mocked(gateway.listAnalyses).mockResolvedValue({ items: [other], total: 1, limited_by_inference: false })
  let deleted!: () => void
  vi.mocked(gateway.deleteAnalysis).mockImplementation(() => new Promise(resolve => { deleted = resolve }))
  render(<View />)
  await analyze()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.more' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'analysisCenter.delete' }))
  fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
  await waitFor(() => expect(gateway.deleteAnalysis).toHaveBeenCalledWith('analysis'))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.expandHistory' }))
  fireEvent.click(await screen.findByRole('button', { name: /Another desktop/ }))
  await screen.findByText('Another desktop')
  await act(async () => deleted())
  await waitFor(() => expect(screen.getByText('Another desktop')).toBeInTheDocument())
})
