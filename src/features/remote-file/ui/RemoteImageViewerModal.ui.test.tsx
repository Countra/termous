import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FileOperationTask, RemoteImageFile } from '#entities/file'
import type { FileOperationGateway } from '../model/fileOperationGateway'
import { RemoteImageViewerModal } from './RemoteImageViewerModal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let stageWidth = 1000
let stageHeight = 500
const resizeObservers = new Set<ResizeObserverCallback>()
const task = { id: 'image-read', file_session_id: 'session', type: 'read_image', status: 'completed', revision: 1, progress_percent: 100 } as FileOperationTask
const metadata = { name: 'large.jpg', path: '/large.jpg', content_type: 'image/jpeg', size: 1000 } as RemoteImageFile

beforeEach(() => {
  stageWidth = 1000
  stageHeight = 500
  resizeObservers.clear()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { resizeObservers.add(this.callback) }
    unobserve() {}
    disconnect() { resizeObservers.delete(this.callback) }
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('remote-image-viewer-stage') ? stageWidth : 0 })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('remote-image-viewer-stage') ? stageHeight : 0 })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function imageApi() {
  return {
    createFileSessionImageReadOperation: vi.fn().mockResolvedValue(task),
    fileOperationResult: vi.fn().mockResolvedValue(metadata),
    fileOperationBlobResult: vi.fn().mockResolvedValue(new Blob(['image'])),
    cancelFileOperation: vi.fn().mockResolvedValue(undefined),
    fileOperation: vi.fn().mockResolvedValue(task),
    fileOperationEventsUrl: vi.fn().mockReturnValue('ws://localhost/image-events'),
  } as unknown as FileOperationGateway
}

function viewer(api: FileOperationGateway, path = '/large.jpg', open = true) {
  return <ConfigProvider theme={{ token: { motion: false } }}><RemoteImageViewerModal api={api} open={open} fileSessionId="session" path={path} theme="dark" onClose={vi.fn()} /></ConfigProvider>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

async function preview() {
  const api = imageApi()
  const view = render(viewer(api))
  const image = await screen.findByAltText('large.jpg')
  Object.defineProperties(image, { naturalWidth: { value: 5761 }, naturalHeight: { value: 3240 } })
  fireEvent.load(image)
  await waitFor(() => expect(screen.getByRole('button', { name: 'files.imageViewerZoomOut' })).toBeEnabled())
  return { ...view, image: image as HTMLImageElement }
}

function scale(image: HTMLImageElement) {
  return Number(image.style.transform.match(/scale\(([^)]+)\)/)?.[1])
}

it('首次缩小从适应比例连续变化，原始尺寸与重新适应均准确', async () => {
  const { image } = await preview()
  const fitted = scale(image)
  expect(fitted).toBeCloseTo(464 / 3240)
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerZoomOut' }))
  expect(scale(image)).toBeCloseTo(fitted / 1.2)
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerZoomIn' }))
  expect(scale(image)).toBeCloseTo(fitted)
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerActualSize' }))
  expect(scale(image)).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerFit' }))
  expect(scale(image)).toBeCloseTo(fitted)
})

it('旋转适配与窗口缩放不撑大图片舞台，手动比例不被窗口变化重置', async () => {
  const { image } = await preview()
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerRotateRight' }))
  expect(scale(image)).toBeCloseTo(464 / 5761)
  expect(screen.getByRole('button', { name: 'files.imageViewerZoomOut' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerZoomOut' }))
  expect(scale(image)).toBeCloseTo(464 / 5761 / 1.2)
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerFit' }))
  stageHeight = 700
  act(() => resizeObservers.forEach((callback) => callback([], {} as ResizeObserver)))
  expect(scale(image)).toBeCloseTo(664 / 5761)
  fireEvent.click(screen.getByRole('button', { name: 'files.imageViewerActualSize' }))
  stageHeight = 400
  act(() => resizeObservers.forEach((callback) => callback([], {} as ResizeObserver)))
  expect(scale(image)).toBe(1)
})

it('滚轮缩放阻止页面滚动，解码失败释放图片并提供重新读取', async () => {
  const { image, unmount } = await preview()
  const fitted = scale(image)
  const wheel = new WheelEvent('wheel', { deltaY: 60, clientX: 120, clientY: 80, bubbles: true, cancelable: true })
  act(() => image.parentElement!.dispatchEvent(wheel))
  expect(wheel.defaultPrevented).toBe(true)
  expect(scale(image)).toBeLessThan(fitted)
  fireEvent.error(image)
  expect(screen.getByText('files.imageViewerUnsupported')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'files.imageViewerZoomIn' })).toBeDisabled()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  unmount()
  expect(resizeObservers.size).toBe(0)
})

it('窗口卸载后迟到的读取任务会取消，不再建立观察器', async () => {
  vi.useFakeTimers()
  const creation = deferred<FileOperationTask>()
  const api = imageApi()
  vi.mocked(api.createFileSessionImageReadOperation).mockReturnValue(creation.promise)
  const view = render(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(api.createFileSessionImageReadOperation).toHaveBeenCalledOnce()
  view.unmount()
  await act(async () => { creation.resolve({ ...task, status: 'running' }) })
  expect(api.cancelFileOperation).toHaveBeenCalledWith(task.id)
  expect(api.fileOperationEventsUrl).not.toHaveBeenCalled()
  expect(api.fileOperationResult).not.toHaveBeenCalled()
})

it('关闭后迟到的元数据不会继续下载图片正文', async () => {
  vi.useFakeTimers()
  const result = deferred<RemoteImageFile>()
  const api = imageApi()
  vi.mocked(api.fileOperationResult).mockReturnValue(result.promise)
  const view = render(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(api.fileOperationResult).toHaveBeenCalledOnce()
  view.rerender(viewer(api, '/large.jpg', false))
  expect(vi.mocked(api.fileOperationResult).mock.calls[0]?.[1]?.aborted).toBe(true)
  await act(async () => { result.resolve(metadata) })
  expect(api.fileOperationBlobResult).not.toHaveBeenCalled()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('已完成图片切换到新图片后立即切回，仍会读取原图片且忽略迟到结果', async () => {
  vi.useFakeTimers()
  const creation = deferred<FileOperationTask>()
  const api = imageApi()
  const create = vi.mocked(api.createFileSessionImageReadOperation)
  create.mockResolvedValueOnce(task).mockReturnValueOnce(creation.promise).mockResolvedValueOnce({ ...task, id: 'image-again' })
  const view = render(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  view.rerender(viewer(api, '/other.jpg'))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.queryByAltText('large.jpg')).not.toBeInTheDocument()
  view.rerender(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(create.mock.calls.map(([, path]) => path)).toEqual(['/large.jpg', '/other.jpg', '/large.jpg'])
  await act(async () => { creation.resolve({ ...task, id: 'other-read' }) })
  expect(vi.mocked(api.fileOperationResult).mock.calls.map(([id]) => id)).not.toContain('other-read')
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
})

it('旧正文在新图片之后返回时不会分配或替换 Blob 地址', async () => {
  vi.useFakeTimers()
  const oldBlob = deferred<Blob>()
  const api = imageApi()
  vi.mocked(api.fileOperationBlobResult).mockReturnValueOnce(oldBlob.promise)
  const view = render(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(api.fileOperationBlobResult).toHaveBeenCalledOnce()
  view.rerender(viewer(api, '/other.jpg'))
  expect(vi.mocked(api.fileOperationBlobResult).mock.calls[0]?.[1]?.aborted).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  await act(async () => { oldBlob.resolve(new Blob(['old image'])) })
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
})

it('关闭重开同一路径时，旧请求结束不会解除新请求的去重保护', async () => {
  vi.useFakeTimers()
  const first = deferred<FileOperationTask>()
  const second = deferred<FileOperationTask>()
  const api = imageApi()
  const create = vi.mocked(api.createFileSessionImageReadOperation)
  create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const view = render(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  view.rerender(viewer(api, '/large.jpg', false))
  view.rerender(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  await act(async () => { first.resolve(task) })
  view.rerender(viewer(api))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(create).toHaveBeenCalledTimes(2)
  await act(async () => { second.resolve({ ...task, id: 'current-read' }) })
  expect(api.fileOperationResult).toHaveBeenCalledExactlyOnceWith('current-read', expect.any(AbortSignal))
})
