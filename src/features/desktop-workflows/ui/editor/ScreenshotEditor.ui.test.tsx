import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App, ConfigProvider } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Step, WorkflowGateway } from '#entities/desktop-workflow'
import { WorkflowController } from '../../model/workspace/WorkflowController'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { ScreenshotEditor } from './ScreenshotEditor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}><App>{children}</App></ConfigProvider>
const step: Step = { id: 'image', kind: 'image.assert', name: '', action: {}, image: { asset_id: 'original', offset: { x: 4, y: 6 }, threshold: .95, anchor: { x: 2, y: 3 } } }
const gateway = (): WorkflowMediaGateway => ({ openPreview: vi.fn().mockResolvedValue({ id: 'preview', state: 'ready' }), closePreview: vi.fn().mockResolvedValue(undefined), capture: vi.fn(), match: vi.fn(), upload: vi.fn(), asset: vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/png' })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('模板预览与选区应用', () => {
  it('引导暂停截图观察，退出后按原目标恢复且不修改配置', async () => {
    const api = gateway()
    const change = vi.fn()
    const props = { gateway: api, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: change,
      sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }] }
    vi.mocked(api.capture).mockImplementation(() => new Promise(() => {}))
    const view = render(<ScreenshotEditor {...props} enabled={false} />, { wrapper })
    await act(async () => {})
    expect(api.openPreview).not.toHaveBeenCalled()
    expect(api.capture).not.toHaveBeenCalled()
    view.rerender(<ScreenshotEditor {...props} />)
    await waitFor(() => expect(api.capture).toHaveBeenCalledOnce())
    view.rerender(<ScreenshotEditor {...props} enabled={false} />)
    await waitFor(() => expect(api.closePreview).toHaveBeenCalledExactlyOnceWith('preview'))
    expect(change).not.toHaveBeenCalled()
  })

  it('截图读取期间卸载只关闭一次观察，迟到响应不会重新显示画面', async () => {
    const api = gateway()
    let finish!: (value: Awaited<ReturnType<WorkflowMediaGateway['capture']>>) => void
    vi.mocked(api.capture).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const view = render(<ScreenshotEditor gateway={api} target={{ mode: 'session', id: 'session', connectionGeneration: 1 }}
      onTargetChange={vi.fn()} onChange={vi.fn()} sessions={[{ id: 'session', profile_name: '合成桌面', protocol: 'vnc', connection_generation: 1, status: 'streaming' }]} />, { wrapper })
    await waitFor(() => expect(api.capture).toHaveBeenCalledOnce())
    view.unmount()
    expect(api.closePreview).toHaveBeenCalledExactlyOnceWith('preview')
    await act(async () => finish({ blob: new Blob(['screen']), metadata: { width: 1000, height: 500, desktop_width: 1000, desktop_height: 500, connection_generation: 1, display_epoch: 1, frame_sequence: 1, region: { x: 0, y: 0, width: 1000, height: 500 }, captured_at: '' } }))
    expect(api.closePreview).toHaveBeenCalledOnce()
    expect(screen.queryByRole('img', { name: 'desktopWorkflow.readonlyScreen' })).not.toBeInTheDocument()
  })

  it('草稿属性重绘不重新读取缩略图，资源变化时才回收并加载', async () => {
    let sequence = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:template-${++sequence}`)
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.stubGlobal('IntersectionObserver', undefined)
    const api = gateway()
    const props = { gateway: api, target: { mode: 'session' as const }, onTargetChange: vi.fn(), onChange: vi.fn(), sessions: [], step }
    const view = render(<ScreenshotEditor {...props} />, { wrapper })
    await waitFor(() => expect(screen.getByRole('img', { name: 'desktopWorkflow.template' })).toHaveAttribute('src', 'blob:template-1'))
    const image = screen.getByRole('img', { name: 'desktopWorkflow.template' })
    for (const threshold of [.8, .85, .9]) view.rerender(<ScreenshotEditor {...props} step={{ ...step, image: { ...step.image!, threshold } }} />)
    await act(async () => {})
    expect(api.asset).toHaveBeenCalledOnce()
    expect(screen.getByRole('img', { name: 'desktopWorkflow.template' })).toBe(image)
    expect(revoke).not.toHaveBeenCalled()
    view.rerender(<ScreenshotEditor {...props} step={{ ...step, image: { ...step.image!, asset_id: 'replacement' } }} />)
    await waitFor(() => expect(api.asset).toHaveBeenCalledTimes(2))
    expect(revoke).toHaveBeenCalledWith('blob:template-1')
  })

  it('微调完成后才裁剪上传，失败保留原模板，成功保存来源且重新打开后恢复选框', async () => {
    let sequence = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:image-${++sequence}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    let encode!: BlobCallback
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { encode = callback })
    const api = gateway()
    vi.mocked(api.capture).mockResolvedValue({ blob: new Blob(['screen']), metadata: { width: 1000, height: 500, desktop_width: 1000, desktop_height: 500, connection_generation: 1, display_epoch: 1, frame_sequence: 1, region: { x: 0, y: 0, width: 1000, height: 500 }, captured_at: '' } })
    vi.mocked(api.upload).mockRejectedValueOnce(new Error('上传失败')).mockResolvedValue({ id: 'cropped', width: 201, height: 101, size: 10, sha256: '', created_at: '' })
    const change = vi.fn()
    const host = new WorkflowController(api as WorkflowGateway)
    const props = { gateway: api, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: change, onMediaTask: host.trackMediaTask,
      sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }], step }
    const view = render(<ScreenshotEditor {...props} />, { wrapper })
    const image = await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 40, width: 500, height: 250 } as DOMRect)
    const canvas = screen.getByRole('group', { name: 'desktopWorkflow.selection.canvas' })
    canvas.setPointerCapture = vi.fn(); canvas.hasPointerCapture = vi.fn().mockReturnValue(true); canvas.releasePointerCapture = vi.fn()
    fireEvent.load(image)
    fireEvent.pointerDown(canvas, { clientX: 70, clientY: 90, button: 0, pointerId: 1, isPrimary: true })
    fireEvent.pointerUp(canvas, { clientX: 170, clientY: 140, button: 0, pointerId: 1, isPrimary: true })
    expect(api.upload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useTemplate' }))
    let settled = false
    const handoff = host.settleMedia().then(() => { settled = true })
    await act(async () => {})
    expect(settled).toBe(false)
    expect(api.upload).not.toHaveBeenCalled()
    await act(async () => encode(new Blob(['cropped'], { type: 'image/png' })))
    await handoff
    expect(await screen.findByText('上传失败')).toBeVisible()
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useTemplate' }))
    await act(async () => encode(new Blob(['cropped'], { type: 'image/png' })))
    await waitFor(() => expect(change).toHaveBeenCalledOnce())
    const [id, update] = change.mock.calls[0] as [string, (value: Step) => Step]
    expect(id).toBe(step.id)
    const updated = update(step)
    expect(updated.image).toEqual({ ...step.image, asset_id: 'cropped', anchor: undefined,
      template_source: { region: { x: 100, y: 100, width: 201, height: 101 }, reference_width: 1000, reference_height: 500 } })
    expect(drawImage).toHaveBeenCalledWith(image, 100, 100, 201, 101, 0, 0, 201, 101)
    expect(api.asset).toHaveBeenCalledOnce()
    view.rerender(<ScreenshotEditor {...props} step={{ ...step, id: 'next' }} />)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    expect(screen.getByText('desktopWorkflow.selection.templateSourceMissing')).toBeVisible()
    view.rerender(<ScreenshotEditor {...props} step={JSON.parse(JSON.stringify(updated)) as Step} />)
    expect(screen.getByText('201 × 101')).toBeVisible()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_template' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('desktopWorkflow.selection.templateSourceMissing')).not.toBeInTheDocument()
    view.unmount()
    expect(api.closePreview).toHaveBeenCalledWith('preview')
    host.dispose()
  })

  it('打开配置直接还原查找区域，可继续微调，配置清除或参考尺寸失效时不显示旧框', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screen')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const api = gateway()
    vi.mocked(api.capture).mockResolvedValue({ blob: new Blob(['screen']), metadata: { width: 1000, height: 500, desktop_width: 1000, desktop_height: 500, connection_generation: 1, display_epoch: 1, frame_sequence: 1, region: { x: 0, y: 0, width: 1000, height: 500 }, captured_at: '' } })
    const configured = { ...step, image: { ...step.image!, region: { x: 100, y: 100, width: 200, height: 100 }, reference_width: 1000, reference_height: 500 } }
    const change = vi.fn()
    const props = { gateway: api, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: change,
      sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }], step: configured }
    const view = render(<ScreenshotEditor {...props} />, { wrapper })
    await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_region' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }).parentElement).toHaveStyle({ left: '10%', top: '20%', width: '20%', height: '20%' })
    expect(change).not.toHaveBeenCalled()
    fireEvent.load(screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }), { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useRegion' }))
    await waitFor(() => expect(change).toHaveBeenCalledOnce())
    const update = change.mock.calls[0]![1] as (value: Step) => Step
    const updated = update(configured)
    expect(updated.image).toEqual({ ...configured.image, region: { x: 101, y: 100, width: 200, height: 100 } })
    expect(api.upload).not.toHaveBeenCalled()
    view.rerender(<ScreenshotEditor {...props} step={updated} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
    view.rerender(<ScreenshotEditor {...props} step={{ ...configured, image: { ...configured.image, region: undefined } }} />)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    view.rerender(<ScreenshotEditor {...props} step={{ ...configured, image: { ...configured.image, reference_width: 2000 } }} />)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    view.rerender(<ScreenshotEditor {...props} step={{ ...configured, image: { ...configured.image, region: { x: 900, y: 100, width: 200, height: 100 } } }} />)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
  })

  it('模板来源与查找区域独立回显，失效来源隐藏，导入替换模板后清除旧来源', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screen')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const api = gateway()
    vi.mocked(api.capture).mockResolvedValue({ blob: new Blob(['screen']), metadata: { width: 1000, height: 500, desktop_width: 1000, desktop_height: 500, connection_generation: 1, display_epoch: 1, frame_sequence: 1, region: { x: 0, y: 0, width: 1000, height: 500 }, captured_at: '' } })
    vi.mocked(api.upload).mockResolvedValue({ id: 'imported', width: 20, height: 10, size: 10, sha256: '', created_at: '' })
    const source = { region: { x: 100, y: 100, width: 200, height: 100 }, reference_width: 1000, reference_height: 500 }
    const configured = { ...step, image: { ...step.image!, template_source: source, region: { x: 0, y: 0, width: 900, height: 400 }, reference_width: 1000, reference_height: 500 } }
    const change = vi.fn()
    const props = { gateway: api, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: change,
      sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }], step: configured }
    const view = render(<ScreenshotEditor {...props} />, { wrapper })
    await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_template' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('200 × 100')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.select_region' }))
    expect(screen.getByText('900 × 400')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.select_template' }))
    expect(screen.getByText('200 × 100')).toBeVisible()
    for (const template_source of [{ ...source, reference_width: 2000 }, { ...source, region: { ...source.region, x: 950 } }]) {
      view.rerender(<ScreenshotEditor {...props} step={{ ...configured, image: { ...configured.image, template_source } }} />)
      expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    }
    view.rerender(<ScreenshotEditor {...props} />)
    expect(screen.getByText('200 × 100')).toBeVisible()
    expect(change).not.toHaveBeenCalled()
    const file = new File(['import'], 'template.png', { type: 'image/png' })
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(change).toHaveBeenCalledOnce())
    const edit = change.mock.calls[0]![1] as (value: Step) => Step
    const updated = edit(configured)
    expect(updated.image).toEqual({ ...configured.image, asset_id: 'imported', anchor: undefined, template_source: undefined })
    view.rerender(<ScreenshotEditor {...props} step={updated} />)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
  })

  it.each(['image.wait', 'if', 'pointer.click'] as const)('%s 按配置还原区域，手动模式只作用于当前步骤', async kind => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screen')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const api = gateway()
    vi.mocked(api.capture).mockResolvedValue({ blob: new Blob(['screen']), metadata: { width: 1000, height: 500, desktop_width: 1000, desktop_height: 500, connection_generation: 1, display_epoch: 1, frame_sequence: 1, region: { x: 0, y: 0, width: 1000, height: 500 }, captured_at: '' } })
    const image = { ...step.image!, region: { x: 100, y: 100, width: 200, height: 100 }, reference_width: 1000, reference_height: 500 }
    const configured: Step = { ...step, kind, ...(kind === 'pointer.click' ? { image: undefined, target: { kind: 'image', image } } : { image }) }
    const props = { gateway: api, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: vi.fn(),
      sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }], step: configured }
    const view = render(<ScreenshotEditor {...props} />, { wrapper })
    await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_region' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('200 × 100')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.select_template' }))
    view.rerender(<ScreenshotEditor {...props} step={{ ...configured, name: '修改步骤名称' }} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_template' })).toHaveAttribute('aria-pressed', 'true')
    view.rerender(<ScreenshotEditor {...props} step={{ ...configured, id: 'next' }} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_region' })).toHaveAttribute('aria-pressed', 'true')
    view.rerender(<ScreenshotEditor {...props} />)
    expect(screen.getByText('200 × 100')).toBeVisible()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_region' })).toHaveAttribute('aria-pressed', 'true')
    view.rerender(<ScreenshotEditor {...props} step={{ id: 'point', kind: 'pointer.click', name: '', action: {}, target: { kind: 'point', x: 50, y: 30, reference_width: 1000, reference_height: 500 } }} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_point' })).toHaveAttribute('aria-pressed', 'true')
    expect(props.onChange).not.toHaveBeenCalled()
    expect(api.upload).not.toHaveBeenCalled()
  })

  it('拖拽起终点分别还原各自区域，目标改为坐标定位时切回选点', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screen')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const api = gateway()
    vi.mocked(api.capture).mockResolvedValue({ blob: new Blob(['screen']), metadata: { width: 1000, height: 500, desktop_width: 1000, desktop_height: 500, connection_generation: 1, display_epoch: 1, frame_sequence: 1, region: { x: 0, y: 0, width: 1000, height: 500 }, captured_at: '' } })
    const image = { ...step.image!, region: { x: 100, y: 100, width: 200, height: 100 }, reference_width: 1000, reference_height: 500 }
    const configured: Step = { id: 'drag', kind: 'pointer.drag', name: '', action: {}, target: { kind: 'image', image },
      end_target: { kind: 'image', image: { ...image, region: { x: 400, y: 200, width: 150, height: 75 } } } }
    const props = { gateway: api, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: vi.fn(),
      sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }], step: configured }
    const view = render(<ScreenshotEditor {...props} />, { wrapper })
    await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
    expect(screen.getByText('200 × 100')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'desktopWorkflow.select_template' }))
    await user.click(screen.getByRole('combobox', { name: 'desktopWorkflow.target' }))
    await user.click(screen.getByText('desktopWorkflow.endTarget', { exact: true }))
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_region' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('150 × 75')).toBeVisible()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }).parentElement).toHaveStyle({ left: '40%', top: '40%', width: '15%', height: '15%' })
    view.rerender(<ScreenshotEditor {...props} step={{ ...configured, end_target: { kind: 'point', x: 40, y: 20, reference_width: 1000, reference_height: 500 } }} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.select_point' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    expect(props.onChange).not.toHaveBeenCalled()
    expect(api.upload).not.toHaveBeenCalled()
  })
})
