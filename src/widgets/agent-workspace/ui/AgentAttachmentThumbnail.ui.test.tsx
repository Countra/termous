import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAttachment } from '#entities/agent'
import { AgentAttachmentThumbnail } from './AgentAttachmentThumbnail.tsx'

describe('AgentAttachmentThumbnail', () => {
  const createObjectURL = vi.fn<(blob: Blob) => string>()
  const revokeObjectURL = vi.fn<(url: string) => void>()
  let originalCreateObjectURL: PropertyDescriptor | undefined
  let originalRevokeObjectURL: PropertyDescriptor | undefined
  let originalIntersectionObserver: PropertyDescriptor | undefined

  beforeEach(() => {
    originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    originalIntersectionObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')
    createObjectURL.mockReset()
    revokeObjectURL.mockReset()
    FakeIntersectionObserver.instances = []
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: FakeIntersectionObserver,
    })
  })

  afterEach(() => {
    cleanup()
    restoreProperty(URL, 'createObjectURL', originalCreateObjectURL)
    restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    restoreProperty(globalThis, 'IntersectionObserver', originalIntersectionObserver)
  })

  it('立即为本地 Blob 创建缩略图并在卸载时回收 URL', async () => {
    const file = new File(['image'], 'screen.png', { type: 'image/png' })
    createObjectURL.mockReturnValue('blob:local-image')
    const view = render(
      <AgentAttachmentThumbnail source={{ kind: 'local', blob: file }} alt="screen.png" />,
    )

    const image = await screen.findByAltText('screen.png')
    expect(image).toHaveAttribute('src', 'blob:local-image')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(createObjectURL).toHaveBeenCalledWith(file)
    expect(FakeIntersectionObserver.instances).toHaveLength(0)

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-image')
  })

  it('历史附件仅在接近视口后通过受控加载器读取', async () => {
    const blob = new Blob(['remote'], { type: 'image/png' })
    const load = vi.fn(async () => blob)
    createObjectURL.mockReturnValue('blob:remote-image')
    const view = render(
      <AgentAttachmentThumbnail
        source={{ kind: 'remote', attachment: attachment(), load }}
        alt="history.png"
      />,
    )

    expect(load).not.toHaveBeenCalled()
    expect(FakeIntersectionObserver.instances[0]?.options).toMatchObject({
      rootMargin: '160px',
      threshold: 0.01,
    })

    act(() => FakeIntersectionObserver.instances[0]?.emit(true))

    const image = await screen.findByAltText('history.png')
    expect(image).toHaveAttribute('src', 'blob:remote-image')
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attachment-image' }),
      expect.any(AbortSignal),
    )
    expect(createObjectURL).toHaveBeenCalledWith(blob)

    act(() => FakeIntersectionObserver.instances[0]?.emit(false))
    await waitFor(() => expect(view.container.firstElementChild).toHaveAttribute('data-state', 'idle'))
    expect(screen.queryByAltText('history.png')).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:remote-image')
  })

  it('离开视口或卸载时取消未完成的历史附件加载', async () => {
    const pending = deferred<Blob>()
    let signal: AbortSignal | undefined
    const load = vi.fn((_attachment: AgentAttachment, nextSignal?: AbortSignal) => {
      signal = nextSignal
      return pending.promise
    })
    const view = render(
      <AgentAttachmentThumbnail
        source={{ kind: 'remote', attachment: attachment(), load }}
        alt="history.png"
      />,
    )
    act(() => FakeIntersectionObserver.instances[0]?.emit(true))
    await waitFor(() => expect(load).toHaveBeenCalledOnce())

    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      pending.resolve(new Blob(['late'], { type: 'image/png' }))
      await pending.promise
    })
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('加载失败和图片解码失败时展示占位并且 URL 只回收一次', async () => {
    const failedLoad = vi.fn(async () => { throw new Error('failed') })
    const first = render(
      <AgentAttachmentThumbnail
        source={{ kind: 'remote', attachment: attachment(), load: failedLoad }}
        alt="failed.png"
      />,
    )
    act(() => FakeIntersectionObserver.instances[0]?.emit(true))
    await waitFor(() => expect(first.container.firstElementChild).toHaveAttribute('data-state', 'failed'))
    expect(createObjectURL).not.toHaveBeenCalled()
    first.unmount()

    const blob = new Blob(['invalid image'], { type: 'image/png' })
    const load = vi.fn(async () => blob)
    createObjectURL.mockReturnValue('blob:invalid-image')
    const second = render(
      <AgentAttachmentThumbnail
        source={{ kind: 'remote', attachment: attachment({ revision: 2 }), load }}
        alt="invalid.png"
      />,
    )
    act(() => FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1]?.emit(true))
    const image = await screen.findByAltText('invalid.png')

    fireEvent.error(image)

    await waitFor(() => expect(second.container.firstElementChild).toHaveAttribute('data-state', 'failed'))
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:invalid-image')
    second.unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('切换对象 URL 后忽略旧图片节点迟到的错误事件', async () => {
    const firstFile = new File(['first'], 'first.png', { type: 'image/png' })
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' })
    createObjectURL
      .mockReturnValueOnce('blob:first-image')
      .mockReturnValueOnce('blob:second-image')
    const view = render(
      <AgentAttachmentThumbnail source={{ kind: 'local', blob: firstFile }} alt="image.png" />,
    )
    const firstImage = await screen.findByAltText('image.png')

    view.rerender(
      <AgentAttachmentThumbnail source={{ kind: 'local', blob: secondFile }} alt="image.png" />,
    )
    const secondImage = await waitFor(() => {
      const image = screen.getByAltText('image.png')
      expect(image).toHaveAttribute('src', 'blob:second-image')
      return image
    })

    expect(secondImage).not.toBe(firstImage)
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:first-image')
    fireEvent.error(firstImage)
    expect(screen.getByAltText('image.png')).toHaveAttribute('src', 'blob:second-image')

    view.unmount()
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:second-image')
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('运行环境不支持 IntersectionObserver 时仍可加载历史缩略图', async () => {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: undefined,
    })
    createObjectURL.mockReturnValue('blob:fallback-image')
    const load = vi.fn(async () => new Blob(['fallback'], { type: 'image/png' }))
    const view = render(
      <AgentAttachmentThumbnail
        source={{ kind: 'remote', attachment: attachment(), load }}
        alt="fallback.png"
      />,
    )

    expect(await screen.findByAltText('fallback.png'))
      .toHaveAttribute('src', 'blob:fallback-image')
    expect(load).toHaveBeenCalledOnce()
    view.unmount()
  })
})

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  readonly options?: IntersectionObserverInit
  private readonly callback: IntersectionObserverCallback
  private target?: Element

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    this.target = target
  }

  disconnect() {
    this.target = undefined
  }

  emit(isIntersecting: boolean) {
    if (!this.target) return
    this.callback([{
      target: this.target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function attachment(overrides: Partial<AgentAttachment> = {}): AgentAttachment {
  return {
    id: 'attachment-image',
    session_id: 'session-one',
    original_name: 'history.png',
    mime_type: 'image/png',
    kind: 'image',
    size_bytes: 128,
    state: 'bound',
    revision: 1,
    created_at: '2026-08-31T00:00:00Z',
    updated_at: '2026-08-31T00:00:00Z',
    ...overrides,
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => { resolve = done })
  return { promise, resolve }
}

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else Reflect.deleteProperty(target, key)
}
