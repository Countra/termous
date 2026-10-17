import { act, fireEvent, render as renderUI, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagePreview } from './ImagePreview.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const render = (element: ReactElement) => renderUI(element, {
  wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
})

const createURL = vi.fn<(blob: Blob) => string>()
const revokeURL = vi.fn()
let originalCreate: PropertyDescriptor | undefined
let originalRevoke: PropertyDescriptor | undefined

beforeEach(() => {
  originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  createURL.mockReset().mockReturnValue('blob:preview')
  revokeURL.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeURL })
})

afterEach(() => {
  for (const [key, descriptor] of [['createObjectURL', originalCreate], ['revokeObjectURL', originalRevoke]] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor)
    else Reflect.deleteProperty(URL, key)
  }
})

function measureViewport(width = 800, height = 450) {
  const viewport = screen.getByRole('region', { name: 'imagePreview.canvas' })
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height },
    clientLeft: { configurable: true, value: 1 }, clientTop: { configurable: true, value: 1 } })
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 80, width: width + 2, height: height + 2 } as DOMRect)
  viewport.setPointerCapture = vi.fn()
  viewport.hasPointerCapture = vi.fn().mockReturnValue(true)
  viewport.releasePointerCapture = vi.fn()
  return viewport
}

async function preview(width = 1600, height = 900) {
  const load = vi.fn(async () => new Blob(['image']))
  const view = render(<ImagePreview source={{ id: 'one', title: '图片', load }} onClose={vi.fn()} />)
  const image = await screen.findByAltText('图片')
  const viewport = measureViewport()
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } })
  fireEvent.load(image)
  await waitFor(() => expect(viewport).toHaveAttribute('aria-busy', 'false'))
  await waitFor(() => expect(screen.getByText(`${width} × ${height}`)).toBeVisible())
  return { ...view, image, viewport, load }
}

const pointer = (x: number, y: number, id = 1) => ({ clientX: x, clientY: y, pointerId: id, isPrimary: true, button: 0 })
const offset = (image: HTMLElement) => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(image.style.transform)!
  return { x: Number(match[1]), y: Number(match[2]) }
}

describe('共用图片查看器', () => {
  it('加载后支持原始尺寸、缩放与适应窗口，关闭时只回收自己的 URL', async () => {
    const source = { id: 'one', title: '图片', load: async () => new Blob(['image']) }
    const onClose = vi.fn()
    const view = render(<ImagePreview source={source} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'imagePreview.zoomIn' })).toBeDisabled()
    const image = await waitFor(() => {
      const element = screen.getByAltText('图片')
      expect(element).toHaveAttribute('src', 'blob:preview')
      return element
    })
    measureViewport()
    Object.defineProperties(image, { naturalWidth: { value: 1920 }, naturalHeight: { value: 1080 } })
    fireEvent.load(image)
    await waitFor(() => expect(screen.getByText('1920 × 1080')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.actualSize' }))
    expect(image).toHaveStyle({ width: '1920px', height: '1080px' })
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.zoomIn' }))
    expect(image).toHaveStyle({ width: '2400px', height: '1350px' })
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.zoomOut' }))
    expect(screen.getByText('100%')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.fit' }))
    expect(image).toHaveStyle({ width: '800px', height: '450px' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    view.rerender(<ImagePreview onClose={onClose} />)
    expect(revokeURL).toHaveBeenCalledExactlyOnceWith('blob:preview')
  })

  it('切换图片时中止旧加载并丢弃迟到结果，旧节点错误不影响新预览', async () => {
    let resolve!: (value: Blob) => void
    let signal: AbortSignal | undefined
    const pending = new Promise<Blob>((done) => { resolve = done })
    const view = render(<ImagePreview source={{ id: 'old', title: '旧图片', load: (nextSignal) => { signal = nextSignal; return pending } }} onClose={() => undefined} />)
    await waitFor(() => expect(signal).toBeDefined())
    view.rerender(<ImagePreview source={{ id: 'new', title: '新图片', load: async () => new Blob(['new']) }} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByAltText('新图片')).toHaveAttribute('src', 'blob:preview'))
    expect(signal!.aborted).toBe(true)
    await act(async () => { resolve(new Blob(['old'])); await pending })
    expect(createURL).toHaveBeenCalledOnce()
    expect(screen.queryByAltText('旧图片')).not.toBeInTheDocument()
    view.unmount()
    expect(revokeURL).toHaveBeenCalledOnce()
  })

  it('读取及解码失败可重试，失败的 URL 在重试和退出时释放', async () => {
    const load = vi.fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new Error('not available'))
      .mockResolvedValue(new Blob(['invalid']))
    createURL.mockReturnValueOnce('blob:failed').mockReturnValueOnce('blob:retry')
    const view = render(<ImagePreview source={{ id: 'one', title: '图片', load }} onClose={() => undefined} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('imagePreview.failed')
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.retry' }))
    await waitFor(() => expect(screen.getByAltText('图片')).toHaveAttribute('src', 'blob:failed'))
    const old = screen.getByAltText('图片')
    fireEvent.error(old)
    expect(await screen.findByRole('alert')).toHaveTextContent('imagePreview.failed')
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.retry' }))
    await waitFor(() => expect(screen.getByAltText('图片')).toHaveAttribute('src', 'blob:retry'))
    fireEvent.error(old)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(revokeURL).toHaveBeenCalledExactlyOnceWith('blob:failed')
    view.unmount()
    expect(revokeURL).toHaveBeenCalledTimes(2)
  })

  it('滚轮以鼠标位置缩放，限制倍率并只阻止查看区域内的默认滚动，不重复加载图片', async () => {
    const { viewport, image, load } = await preview()
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 701, clientY: 306, ctrlKey: true })
    fireEvent(viewport, wheel)
    const scale = Number.parseFloat(image.style.width) / 1600
    expect(scale).toBeCloseTo(.5 * Math.exp(.2))
    expect((200 - offset(image).x) / scale).toBeCloseTo(400)
    expect(offset(image).y).toBe(0)
    expect(wheel.defaultPrevented).toBe(true)
    const outside = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 })
    fireEvent(document.body, outside)
    expect(outside.defaultPrevented).toBe(false)
    for (let index = 0; index < 10; index++) fireEvent.wheel(viewport, { deltaY: -240, clientX: 501, clientY: 306 })
    expect(screen.getByText('400%')).toBeVisible()
    expect(screen.getByRole('button', { name: 'imagePreview.zoomIn' })).toBeDisabled()
    for (let index = 0; index < 10; index++) fireEvent.wheel(viewport, { deltaY: 240, clientX: 501, clientY: 306 })
    expect(screen.getByText('10%')).toBeVisible()
    expect(screen.getByRole('button', { name: 'imagePreview.zoomOut' })).toBeDisabled()
    expect(offset(image)).toEqual({ x: 0, y: 0 })
    expect(load).toHaveBeenCalledOnce()
    expect(createURL).toHaveBeenCalledOnce()
    expect(image).toHaveAttribute('src', 'blob:preview')
  })

  it('滚轮支持行、页单位及连续事件，超大图片从适应比例平滑缩放', async () => {
    const { viewport, image } = await preview(16000, 9000)
    expect(image).toHaveStyle({ width: '800px' })
    fireEvent.wheel(viewport, { deltaY: -6.25, deltaMode: 1, clientX: 501, clientY: 306 })
    expect(Number.parseFloat(image.style.width) / 16000).toBeCloseTo(.05 * Math.exp(.2))
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.fit' }))
    fireEvent.wheel(viewport, { deltaY: -1, deltaMode: 2, clientX: 501, clientY: 306 })
    expect(Number.parseFloat(image.style.width) / 16000).toBeCloseTo(.05 * Math.exp(.48))
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.fit' }))
    act(() => {
      fireEvent.wheel(viewport, { deltaY: -100, clientX: 501, clientY: 306 })
      fireEvent.wheel(viewport, { deltaY: -100, clientX: 501, clientY: 306 })
    })
    expect(Number.parseFloat(image.style.width) / 16000).toBeCloseTo(.05 * Math.exp(.4))
  })

  it('主指针按住拖动并约束图像边缘，抬起、取消或失焦后停止拖动', async () => {
    const { viewport, image } = await preview()
    fireEvent.pointerDown(viewport, pointer(200, 200))
    expect(viewport.setPointerCapture).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.actualSize' }))
    fireEvent.pointerDown(viewport, { ...pointer(200, 200), button: 2 })
    fireEvent.pointerDown(viewport, { ...pointer(200, 200), isPrimary: false })
    expect(viewport.setPointerCapture).not.toHaveBeenCalled()
    fireEvent.pointerDown(viewport, pointer(200, 200))
    expect(viewport).toHaveAttribute('data-dragging', 'true')
    expect(viewport.setPointerCapture).toHaveBeenCalledWith(1)
    fireEvent.pointerMove(viewport, pointer(280, 250, 2))
    expect(offset(image)).toEqual({ x: 0, y: 0 })
    fireEvent.pointerMove(viewport, pointer(280, 250))
    expect(offset(image)).toEqual({ x: 80, y: 50 })
    fireEvent.pointerMove(viewport, pointer(2000, -2000))
    expect(offset(image)).toEqual({ x: 400, y: -225 })
    fireEvent.pointerUp(viewport, pointer(2000, -2000))
    expect(viewport).toHaveAttribute('data-dragging', 'false')
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1)
    fireEvent.pointerMove(viewport, pointer(300, 300))
    expect(offset(image)).toEqual({ x: 400, y: -225 })
    for (const end of [() => fireEvent.pointerCancel(viewport, pointer(250, 250)), () => fireEvent.lostPointerCapture(viewport, pointer(250, 250)), () => fireEvent.blur(window)]) {
      fireEvent.pointerDown(viewport, pointer(250, 250))
      end()
      expect(viewport).toHaveAttribute('data-dragging', 'false')
    }
  })

  it('双击和快捷键切换原始尺寸与适应窗口，方向键平移，窗口变大后回到居中且停止拖动', async () => {
    const { viewport, image } = await preview()
    fireEvent.doubleClick(viewport)
    expect(screen.getByText('100%')).toBeVisible()
    fireEvent.keyDown(viewport, { key: 'ArrowRight' })
    fireEvent.keyDown(viewport, { key: 'ArrowDown', shiftKey: true })
    expect(offset(image)).toEqual({ x: -40, y: -120 })
    fireEvent.keyDown(viewport, { key: '+' })
    expect(screen.getByText('125%')).toBeVisible()
    fireEvent.keyDown(viewport, { key: '-' })
    fireEvent.keyDown(viewport, { key: '0' })
    expect(image).toHaveStyle({ width: '800px', height: '450px' })
    expect(offset(image)).toEqual({ x: 0, y: 0 })
    fireEvent.keyDown(viewport, { key: '1' })
    fireEvent.keyDown(viewport, { key: '+', ctrlKey: true })
    expect(screen.getByText('100%')).toBeVisible()
    fireEvent.pointerDown(viewport, pointer(250, 250))
    Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 1000 } })
    fireEvent(window, new Event('resize'))
    expect(offset(image)).toEqual({ x: 0, y: 0 })
    expect(viewport).toHaveAttribute('data-dragging', 'false')
    expect(viewport).toHaveAttribute('data-pannable', 'false')
    fireEvent.doubleClick(viewport)
    expect(screen.getByRole('button', { name: 'imagePreview.fit' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('图片失败时停止拖动并停用缩放，切换资源后恢复适应窗口且不保留旧偏移', async () => {
    const { viewport, image, rerender } = await preview()
    fireEvent.click(screen.getByRole('button', { name: 'imagePreview.actualSize' }))
    fireEvent.pointerDown(viewport, pointer(250, 250))
    fireEvent.pointerMove(viewport, pointer(350, 300))
    expect(offset(image)).toEqual({ x: 100, y: 50 })
    fireEvent.error(image)
    expect(viewport).toHaveAttribute('data-dragging', 'false')
    expect(screen.getByRole('button', { name: 'imagePreview.zoomIn' })).toBeDisabled()
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 })
    fireEvent(viewport, wheel)
    expect(wheel.defaultPrevented).toBe(false)
    rerender(<ImagePreview source={{ id: 'new', title: '新图片', load: async () => new Blob(['new']) }} onClose={vi.fn()} />)
    const replacement = await screen.findByAltText('新图片')
    measureViewport()
    Object.defineProperties(replacement, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } })
    fireEvent.load(replacement)
    expect(replacement).toHaveStyle({ width: '800px', height: '450px' })
    expect(offset(replacement)).toEqual({ x: 0, y: 0 })
    expect(screen.getByRole('button', { name: 'imagePreview.fit' })).toHaveAttribute('aria-pressed', 'true')
  })
})
