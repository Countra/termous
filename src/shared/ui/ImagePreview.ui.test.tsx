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
    expect(image).not.toHaveStyle({ width: '1920px', height: '1080px' })
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
})
