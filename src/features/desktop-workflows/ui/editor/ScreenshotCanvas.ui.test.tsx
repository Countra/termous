import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { ScreenshotCanvas } from './ScreenshotCanvas'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>
const pointer = (x: number, y: number, id = 1) => ({ clientX: x, clientY: y, pointerId: id, isPrimary: true, button: 0 })

function setup(patch: Partial<React.ComponentProps<typeof ScreenshotCanvas>> = {}) {
  const apply = vi.fn().mockResolvedValue(true)
  const point = vi.fn()
  render(<ScreenshotCanvas url="blob:screen" size={{ width: 1000, height: 500 }} zoom="0.5" mode="template" busy={false} disabled={false} onApply={apply} onPoint={point} {...patch} />, { wrapper })
  const canvas = screen.getByRole('group', { name: 'desktopWorkflow.selection.canvas' })
  const image = screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 40, left: 20, top: 40, right: 520, bottom: 290, width: 500, height: 250, toJSON() {} })
  canvas.setPointerCapture = vi.fn()
  canvas.hasPointerCapture = vi.fn().mockReturnValue(true)
  canvas.releasePointerCapture = vi.fn()
  fireEvent.load(image)
  return { canvas, image, apply, point }
}

describe('画面选区编辑', () => {
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
    expect(await screen.findByRole('button', { name: 'desktopWorkflow.selection.applied' })).toBeDisabled()
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
