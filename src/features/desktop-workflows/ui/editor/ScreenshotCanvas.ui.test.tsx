import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { ScreenshotCanvas } from './ScreenshotCanvas'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>
const pointer = (x: number, y: number, id = 1) => ({ clientX: x, clientY: y, pointerId: id, isPrimary: true, button: 0 })
const ctrlPointer = (x: number, y: number, id = 1) => ({ ...pointer(x, y, id), ctrlKey: true })

function setup(patch: Partial<React.ComponentProps<typeof ScreenshotCanvas>> = {}) {
  const apply = vi.fn().mockResolvedValue(true)
  const point = vi.fn()
  const props = { url: 'blob:screen', size: { width: 1000, height: 500 }, mode: 'template' as const, busy: false, disabled: false, onApply: apply, onPoint: point, ...patch }
  const rendered = render(<ScreenshotCanvas {...props} />, { wrapper })
  const canvas = screen.getByRole('group', { name: 'desktopWorkflow.selection.canvas' })
  const image = screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  const viewport = screen.getByRole('group', { name: 'desktopWorkflow.previewTools.viewport' })
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 500 }, clientHeight: { configurable: true, value: 250 } })
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 40, width: 500, height: 250 } as DOMRect)
  vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() => {
    const width = Number.parseFloat(canvas.style.width); const height = Number.parseFloat(canvas.style.height)
    const offset = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(canvas.style.transform)!
    const left = 20 + (500 - width) / 2 + Number(offset[1]); const top = 40 + (250 - height) / 2 + Number(offset[2])
    return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} }
  })
  viewport.setPointerCapture = vi.fn(); viewport.hasPointerCapture = vi.fn().mockReturnValue(true); viewport.releasePointerCapture = vi.fn()
  canvas.setPointerCapture = vi.fn()
  canvas.hasPointerCapture = vi.fn().mockReturnValue(true)
  canvas.releasePointerCapture = vi.fn()
  fireEvent(window, new Event('resize'))
  fireEvent.load(image)
  return { ...rendered, props, canvas, viewport, image, apply, point }
}

describe('画面选区编辑', () => {
  it('选框直接左键拖动，不平移截图且整次移动只撤销一步', () => {
    const { canvas, viewport, apply } = setup({ initialRegion: { x: 100, y: 100, width: 200, height: 100 } })
    const move = screen.getByRole('button', { name: 'desktopWorkflow.selection.move' })
    const transform = canvas.style.transform
    fireEvent.pointerDown(move, pointer(100, 100))
    expect(viewport).toHaveAttribute('data-dragging', 'false')
    fireEvent.pointerMove(canvas, pointer(110, 105))
    fireEvent.pointerMove(canvas, pointer(125, 110))
    fireEvent.pointerUp(canvas, pointer(125, 110))
    expect(canvas.style.transform).toBe(transform)
    expect(screen.getByText('200 × 100')).toBeVisible()
    expect(screen.getByText('150')).toBeVisible()
    expect(screen.getByText('120')).toBeVisible()
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.undo' })).toBeDisabled()
    expect(screen.getAllByText('100')).toHaveLength(2)
    expect(apply).not.toHaveBeenCalled()
  })

  it('截图平移在松开 Ctrl 后立即结束，不会误触框选、选点或修改配置', () => {
    const { canvas, viewport, point, apply } = setup({ mode: 'point' })
    fireEvent.keyDown(canvas, { key: '1' })
    fireEvent.pointerDown(canvas, ctrlPointer(270, 165))
    fireEvent.pointerMove(viewport, ctrlPointer(300, 180))
    const moved = canvas.style.transform
    fireEvent.keyUp(window, { key: 'Control' })
    expect(viewport).toHaveAttribute('data-dragging', 'false')
    fireEvent.pointerMove(viewport, pointer(330, 195))
    fireEvent.pointerUp(viewport, pointer(330, 195))
    expect(canvas.style.transform).toBe(moved)
    expect(point).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled()
  })

  it('适应视图无法平移时，Ctrl 拖动也不会误修改选框或调整尺寸', () => {
    const { canvas, viewport, apply } = setup({ mode: 'region', initialRegion: { x: 100, y: 100, width: 200, height: 100 } })
    const transform = canvas.style.transform
    for (const target of [canvas, screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }), screen.getByRole('button', { name: 'desktopWorkflow.selection.resize.nw' })]) {
      fireEvent.pointerDown(target, ctrlPointer(100, 100))
      fireEvent.pointerMove(canvas, ctrlPointer(125, 110))
      fireEvent.pointerUp(canvas, ctrlPointer(125, 110))
    }
    expect(viewport).toHaveAttribute('data-dragging', 'false')
    expect(canvas.style.transform).toBe(transform)
    expect(screen.getAllByText('100')).toHaveLength(2)
    expect(screen.getByText('200 × 100')).toBeVisible()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('手势期间工具栏重排不会改变坐标基准，删除与重置后的选区均可恢复', async () => {
    const { canvas, image, apply } = setup()
    fireEvent.pointerDown(canvas, pointer(70, 90))
    vi.mocked(image.getBoundingClientRect).mockReturnValue({ left: 20, top: 30, width: 480, height: 240 } as DOMRect)
    fireEvent.pointerUp(canvas, pointer(170, 140))
    expect(screen.getByText('201 × 101')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.reset' }))
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useTemplate' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ x: 100, y: 100, width: 201, height: 101 }, image))
  })

  it('每次拖拽只撤销一步，支持尺寸微调、删除恢复和两种重做快捷键', () => {
    const { canvas, apply } = setup()
    fireEvent.pointerDown(canvas, pointer(70, 90))
    for (let x = 80; x <= 170; x += 10) fireEvent.pointerMove(canvas, pointer(x, 140))
    fireEvent.pointerUp(canvas, pointer(170, 140))
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    fireEvent.keyDown(canvas, { key: 'Z', metaKey: true, shiftKey: true })
    fireEvent.keyDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.resize.e' }), { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByText('211 × 101')).toBeVisible()
    fireEvent.keyDown(canvas, { key: 'z', metaKey: true })
    expect(screen.getByText('201 × 101')).toBeVisible()
    fireEvent.keyDown(canvas, { key: 'y', ctrlKey: true })
    expect(screen.getByText('211 × 101')).toBeVisible()
    fireEvent.keyDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }), { key: 'Delete' })
    expect(canvas).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
    expect(screen.getByText('211 × 101')).toBeVisible()
    fireEvent.keyDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.redo' })).toBeDisabled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('滚轮和 Ctrl 拖动只改变视图，选框内及调整柄上也优先平移，缩放后仍按原图坐标应用', async () => {
    const initialRegion = { x: 100, y: 100, width: 200, height: 100 }
    const { canvas, viewport, image, apply, point } = setup({ mode: 'region', initialRegion })
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 270, clientY: 165 })
    fireEvent(viewport, wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(500 * Math.exp(.2))
    const move = screen.getByRole('button', { name: 'desktopWorkflow.selection.move' })
    const handle = screen.getByRole('button', { name: 'desktopWorkflow.selection.resize.e' })
    for (const target of [canvas, move, handle]) {
      const transform = canvas.style.transform
      fireEvent.pointerDown(target, ctrlPointer(270, 165))
      expect(viewport).toHaveAttribute('data-dragging', 'true')
      fireEvent.pointerMove(viewport, ctrlPointer(280, 170))
      fireEvent.pointerUp(viewport, ctrlPointer(280, 170))
      expect(canvas.style.transform).not.toBe(transform)
      expect(viewport).toHaveAttribute('data-dragging', 'false')
    }
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.undo' })).toBeDisabled()
    expect(screen.getByText('200 × 100')).toBeVisible()
    expect(apply).not.toHaveBeenCalled(); expect(point).not.toHaveBeenCalled()
    const rect = image.getBoundingClientRect()
    fireEvent.pointerDown(canvas, pointer(rect.left + rect.width * .30025, rect.top + rect.height * .4005))
    fireEvent.pointerUp(canvas, pointer(rect.left + rect.width * .50025, rect.top + rect.height * .6005))
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useRegion' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ x: 300, y: 200, width: 201, height: 101 }, image))
  })

  it('应用回执保留缩放与历史，外部清除配置会重置历史，重新打开画面恢复适应', async () => {
    const initialRegion = { x: 100, y: 100, width: 200, height: 100 }
    const view = setup({ mode: 'region', initialRegion })
    const { canvas, props, image } = view
    fireEvent.keyDown(canvas, { key: '1' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }), { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useRegion' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled())
    expect(canvas).toHaveFocus()
    view.rerender(<ScreenshotCanvas {...props} initialRegion={{ ...initialRegion, x: 101 }} />)
    expect(screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })).toBe(image)
    expect(canvas).toHaveStyle({ width: '1000px' })
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.undo' }))
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.useRegion' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.redo' }))
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
    view.rerender(<ScreenshotCanvas {...props} initialRegion={undefined} />)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.undo' })).toBeDisabled()
    view.unmount()
    expect(setup().canvas).toHaveStyle({ width: '500px' })
  })

  it('取消手势不污染历史，输入框快捷键与工具按钮的空格操作保持原生行为', () => {
    const { canvas } = setup()
    fireEvent.pointerDown(canvas, pointer(70, 90))
    fireEvent.pointerMove(canvas, pointer(170, 140))
    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.undo' })).toBeDisabled()
    fireEvent.pointerDown(canvas, pointer(70, 90))
    fireEvent.pointerUp(canvas, pointer(170, 140))
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'z', ctrlKey: true })
    expect(screen.getByText('201 × 101')).toBeVisible()
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('button', { name: 'desktopWorkflow.selection.undo' }), space)
    expect(space.defaultPrevented).toBe(false)
  })

  it('缩放后按原始像素绘制、移动、调整边框，确认前不写入配置', async () => {
    const { canvas, image, apply } = setup()
    fireEvent.pointerDown(canvas, pointer(70, 90))
    fireEvent.pointerMove(canvas, pointer(170, 140))
    fireEvent.pointerUp(canvas, pointer(170, 140))
    expect(apply).not.toHaveBeenCalled()
    const move = screen.getByRole('button', { name: 'desktopWorkflow.selection.move' })
    fireEvent.pointerDown(move, pointer(100, 100))
    fireEvent.pointerMove(canvas, pointer(125, 110))
    fireEvent.pointerUp(canvas, pointer(125, 110))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.resize.e' }), pointer(195, 110))
    fireEvent.pointerMove(canvas, pointer(220, 110))
    fireEvent.pointerUp(canvas, pointer(220, 110))
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useTemplate' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ x: 150, y: 120, width: 251, height: 101 }, image))
    fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.selection.updateTemplate' }))
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2))
  })

  it('取消、失去捕获及其他指针不提交半成品，方向键微调可覆盖边界', async () => {
    const initialRegion = { x: 100, y: 100, width: 200, height: 100 }
    const { canvas, image, apply } = setup({ mode: 'region', initialRegion })
    const move = screen.getByRole('button', { name: 'desktopWorkflow.selection.move' })
    fireEvent.pointerDown(move, pointer(100, 100))
    fireEvent.pointerMove(canvas, pointer(150, 150))
    fireEvent.pointerCancel(canvas, pointer(0, 0, 2))
    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
    fireEvent.pointerDown(move, pointer(100, 100))
    fireEvent.pointerMove(canvas, pointer(150, 150))
    fireEvent.lostPointerCapture(canvas, pointer(150, 150))
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
    fireEvent.pointerDown(move, pointer(100, 100))
    fireEvent.pointerMove(canvas, pointer(150, 150))
    fireEvent.blur(window)
    fireEvent.pointerUp(canvas, pointer(150, 150))
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
    fireEvent.pointerDown(move, pointer(100, 100))
    fireEvent.pointerMove(canvas, pointer(-500, 900))
    fireEvent.pointerUp(canvas, pointer(-500, 900))
    fireEvent.keyDown(move, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.resize.s' }), { key: 'ArrowUp' })
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useRegion' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ x: 10, y: 400, width: 200, height: 99 }, image))
  })

  it('框选应用失败保留可重试选区，重置不清除原有配置', async () => {
    const apply = vi.fn().mockResolvedValue(false)
    const initialRegion = { x: 100, y: 100, width: 200, height: 100 }
    setup({ mode: 'region', initialRegion, onApply: apply })
    fireEvent.keyDown(screen.getByRole('button', { name: 'desktopWorkflow.selection.move' }), { key: 'ArrowRight' })
    const button = screen.getByRole('button', { name: 'desktopWorkflow.selection.useRegion' })
    fireEvent.click(button)
    await waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(button).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.reset' }))
    expect(screen.getByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
    expect(apply).toHaveBeenCalledOnce()
  })

  it('选点模式维持直接写入单个坐标，忽略未完成与非主指针操作', () => {
    const { canvas, point, apply } = setup({ mode: 'point' })
    fireEvent.pointerDown(canvas, { ...pointer(100, 100), button: 2 })
    fireEvent.pointerUp(canvas, pointer(120, 100))
    expect(point).not.toHaveBeenCalled()
    fireEvent.pointerDown(canvas, pointer(70, 90))
    fireEvent.pointerUp(canvas, pointer(170, 140, 2))
    expect(point).not.toHaveBeenCalled()
    fireEvent.pointerUp(canvas, pointer(170, 140))
    expect(point).toHaveBeenCalledWith({ x: 300, y: 200 })
    expect(apply).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
  })
})
