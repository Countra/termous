import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Definition, Step, StepResult } from '#entities/desktop-workflow'
import { ImagePreview, type ImagePreviewSource } from '#shared/ui'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { RunStepTimeline } from './RunStepTimeline'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const base: StepResult = { run_id: 'run', index: 1, step_id: 'capture', occurrence: '1', kind: 'capture', state: 'completed', started_at: '2026-10-17T00:00:00Z' }
const expanded = { allExpanded: true, exceptions: [] }
const blob = () => new Blob(['image'], { type: 'image/png' })
const definition = (steps: Step[]): Definition => ({ schema_version: 1, parameters: [], steps })

beforeEach(() => {
  let sequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:execution-${++sequence}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.stubGlobal('IntersectionObserver', undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('报告刷新和打开大图不重新读取缩略图，关闭预览只释放大图资源', async () => {
  const gateway = { asset: vi.fn().mockResolvedValue(blob()) }
  function Report({ state }: { state: string }) {
    const [image, setImage] = useState<ImagePreviewSource>()
    return <ConfigProvider theme={{ token: { motion: false } }}>
      <RunStepTimeline steps={[{ ...base, state, asset_id: 'evidence' }]} gateway={gateway} onImage={setImage} expansion={expanded} />
      <ImagePreview source={image} onClose={() => setImage(undefined)} />
    </ConfigProvider>
  }
  const view = render(<Report state="running" />)
  const trigger = screen.getByRole('button', { name: 'desktopWorkflow.viewEvidence' })
  await waitFor(() => expect(within(trigger).getByRole('img')).toHaveAttribute('src', 'blob:execution-1'))
  const thumbnail = within(trigger).getByRole('img')
  view.rerender(<Report state="completed" />)
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog')
  const preview = await within(dialog).findByAltText('desktopWorkflow.evidence')
  await waitFor(() => expect(preview).toHaveAttribute('src', 'blob:execution-2'))
  Object.defineProperties(preview, { naturalWidth: { value: 1280 }, naturalHeight: { value: 720 } })
  fireEvent.load(preview)
  await waitFor(() => expect(preview).toBeVisible())
  expect(gateway.asset).toHaveBeenCalledTimes(2)
  expect(within(trigger).getByRole('img')).toBe(thumbnail)
  expect(thumbnail).toHaveAttribute('src', 'blob:execution-1')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:execution-2')
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:execution-1')
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:execution-1')
})

it('固定版本的图像任务、图像定位和拖动两端显示各自模板，点击读取对应资源', async () => {
  const image = (asset_id: string) => ({ asset_id, offset: { x: 0, y: 0 }, threshold: .9 })
  const configured = definition([
    ...(['image.wait', 'image.assert', 'if'] as const).map(kind => ({ id: kind, name: kind, kind, action: {}, image: image(kind) })),
    { id: 'click', name: '', kind: 'pointer.click', action: {}, target: { kind: 'image', image: image('click-template') } },
    { id: 'drag', name: '', kind: 'pointer.drag', action: {}, target: { kind: 'image', image: image('drag-start') }, end_target: { kind: 'image', image: image('drag-end') } },
  ])
  const steps = configured.steps.map((step, index) => ({ ...base, index: index + 1, step_id: step.id, kind: step.kind }))
  const gateway = { asset: vi.fn().mockResolvedValue(blob()) }
  const onImage = vi.fn()
  const view = render(<RunStepTimeline steps={steps} definition={configured} gateway={gateway} onImage={onImage} expansion={expanded} />)
  await waitFor(() => expect(gateway.asset).toHaveBeenCalledTimes(6))
  const buttons = screen.getAllByRole('button', { name: /desktopWorkflow.previewTemplate/ })
  expect(buttons).toHaveLength(6)
  const ids = ['image.wait', 'image.assert', 'if', 'click-template', 'drag-start', 'drag-end']
  for (const [index, button] of buttons.entries()) {
    fireEvent.click(button)
    const source = onImage.mock.lastCall![0] as ImagePreviewSource
    expect(source.id).toBe(ids[index])
    const controller = new AbortController()
    await source.load(controller.signal)
    expect(gateway.asset).toHaveBeenLastCalledWith(ids[index], controller.signal)
  }
  expect(onImage.mock.calls[4]![0].title).toContain('desktopWorkflow.target')
  expect(onImage.mock.calls[5]![0].title).toContain('desktopWorkflow.endTarget')
  view.rerender(<RunStepTimeline steps={steps} gateway={gateway} onImage={onImage} expansion={expanded} />)
  expect(screen.queryByRole('button', { name: /desktopWorkflow.previewTemplate/ })).not.toBeInTheDocument()
  expect(screen.getAllByText('desktopWorkflow.actionDetailsUnavailable')).toHaveLength(5)
})

it('证据读取失败不影响模板与执行信息，迟到的旧资源不会覆盖替换后的图片', async () => {
  let finish!: (value: Blob) => void
  const gateway: Pick<WorkflowMediaGateway, 'asset'> = { asset: vi.fn((id: string) => id === 'evidence'
    ? Promise.reject(new Error('证据已清理')) : id === 'old' ? new Promise<Blob>(done => { finish = done }) : Promise.resolve(blob())) }
  const configured = (asset: string) => definition([{ id: base.step_id, name: '', kind: 'image.assert', action: {}, image: { asset_id: asset, offset: { x: 0, y: 0 } } }])
  const props = { steps: [{ ...base, kind: 'image.assert' as const, asset_id: 'evidence' }], gateway, onImage: vi.fn(), expansion: expanded }
  const view = render(<RunStepTimeline {...props} definition={configured('old')} />)
  const evidence = screen.getByRole('button', { name: 'desktopWorkflow.viewEvidence' })
  await waitFor(() => expect(within(evidence).getByRole('img').parentElement).toHaveAttribute('data-state', 'failed'))
  const signal = vi.mocked(gateway.asset).mock.calls.find(call => call[0] === 'old')![1]!
  view.rerender(<RunStepTimeline {...props} definition={configured('new')} />)
  const template = screen.getByRole('button', { name: 'desktopWorkflow.previewTemplate' })
  await waitFor(() => expect(within(template).getByRole('img')).toHaveAttribute('src', 'blob:execution-1'))
  expect(signal.aborted).toBe(true)
  await act(async () => finish(blob()))
  expect(within(template).getByRole('img')).toHaveAttribute('src', 'blob:execution-1')
  expect(URL.createObjectURL).toHaveBeenCalledOnce()
  expect(screen.getByText(base.occurrence, { selector: 'dd' })).toBeVisible()
})
