import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config, DriverHook, PopoverDOM } from 'driver.js'
import { ProductTourEngine, type ProductTourEngineOptions } from './ProductTourEngine.ts'
import type {
  ProductTourDriverAdapter,
  ProductTourDriverFactory,
} from './productTourDriverAdapter.ts'
import type { ProductTourStep } from './productTourSteps.ts'

interface FakeDriverRecord {
  config: Config
  adapter: ProductTourDriverAdapter
  active: () => boolean
  activeIndex: () => number | undefined
  popover: () => PopoverDOM | null
  invokeNext: () => void
  invokePrevious: () => void
}

interface FakeDriverFailures {
  moveTo?: Error
  destroy?: Error
  destroyFailureCount?: number
}

const steps: ProductTourStep[] = [
  { id: 'welcome', title: '欢迎', description: '欢迎' },
  { id: 'vaultNav', title: '凭据库', description: '凭据库' },
]

const activeEngines: ProductTourEngine[] = []

afterEach(() => {
  activeEngines.splice(0).forEach((engine) => engine.dispose())
  document.body.replaceChildren()
  delete document.body.dataset.termousProductTour
})

describe('使用向导引擎 generation 隔离', () => {
  it('旧启动迟到后不会清除新启动状态或允许第三次启动越过', async () => {
    const firstPreparation = createDeferred()
    const secondPreparation = createDeferred()
    const records: FakeDriverRecord[] = []
    const prepareStep = vi.fn()
      .mockImplementationOnce(() => firstPreparation.promise)
      .mockImplementationOnce(() => secondPreparation.promise)
      .mockReturnValue(true)
    const engine = createEngine(prepareStep, records)

    const firstStart = engine.start()
    expect(prepareStep).toHaveBeenCalledTimes(1)
    engine.stop()

    const secondStart = engine.start()
    expect(prepareStep).toHaveBeenCalledTimes(2)

    firstPreparation.resolve()
    await expect(firstStart).resolves.toBe(false)

    await expect(engine.start()).resolves.toBe(false)
    expect(prepareStep).toHaveBeenCalledTimes(2)
    expect(records).toHaveLength(0)

    secondPreparation.resolve()
    await expect(secondStart).resolves.toBe(true)
    expect(records).toHaveLength(1)
  })

  it('旧迁移迟到后不会解锁新一轮向导的迁移按钮', async () => {
    const oldMovePreparation = createDeferred()
    const currentMovePreparation = createDeferred()
    const records: FakeDriverRecord[] = []
    const prepareStep = vi.fn()
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => oldMovePreparation.promise)
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => currentMovePreparation.promise)
      .mockReturnValue(true)
    const engine = createEngine(prepareStep, records)

    await expect(engine.start()).resolves.toBe(true)
    records[0]?.invokeNext()
    expect(prepareStep).toHaveBeenCalledTimes(2)
    expect(records[0]?.popover()?.nextButton).toBeDisabled()

    engine.stop()
    await expect(engine.start()).resolves.toBe(true)
    records[1]?.invokeNext()
    expect(prepareStep).toHaveBeenCalledTimes(4)
    expect(records[1]?.popover()?.nextButton).toBeDisabled()

    oldMovePreparation.resolve()
    await flushPromises()

    expect(records[1]?.popover()?.nextButton).toBeDisabled()
    records[1]?.invokeNext()
    expect(prepareStep).toHaveBeenCalledTimes(4)

    currentMovePreparation.resolve()
    await flushPromises()
    expect(records[1]?.activeIndex()).toBe(1)
  })

  it('每个步骤完成高亮后把焦点放在主操作而不是关闭按钮', async () => {
    const records: FakeDriverRecord[] = []
    const engine = createEngine(vi.fn(() => true), records)

    await expect(engine.start()).resolves.toBe(true)
    expect(document.activeElement).toBe(records[0]?.popover()?.nextButton)
    expect(document.activeElement).not.toBe(records[0]?.popover()?.closeButton)

    records[0]?.invokeNext()
    await flushPromises()
    expect(records[0]?.activeIndex()).toBe(1)
    expect(document.activeElement).toBe(records[0]?.popover()?.nextButton)

    records[0]?.invokePrevious()
    await flushPromises()
    expect(records[0]?.activeIndex()).toBe(0)
    expect(document.activeElement).toBe(records[0]?.popover()?.nextButton)
  })

  it('用户已进入步骤目标操作时不抢回焦点', async () => {
    const records: FakeDriverRecord[] = []
    const input = document.createElement('input')
    document.body.appendChild(input)
    const engine = createEngine(
      vi.fn(() => true),
      records,
      undefined,
      () => input.focus(),
    )

    await expect(engine.start()).resolves.toBe(true)

    expect(document.activeElement).toBe(input)
  })

  it('步骤准备异常时上报错误并停留在当前步骤', async () => {
    const records: FakeDriverRecord[] = []
    const preparationError = new Error('prepare failed')
    const onError = vi.fn()
    const onBlocked = vi.fn()
    const prepareStep = vi.fn()
      .mockReturnValueOnce(true)
      .mockRejectedValueOnce(preparationError)
    const engine = createEngine(
      prepareStep,
      records,
      undefined,
      undefined,
      onError,
      onBlocked,
    )

    await expect(engine.start()).resolves.toBe(true)
    records[0]?.invokeNext()
    await flushPromises()

    expect(records[0]?.activeIndex()).toBe(0)
    expect(records[0]?.popover()?.nextButton).not.toBeDisabled()
    expect(onError).toHaveBeenCalledWith(preparationError)
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('Driver 迁移异常时上报错误、退出向导并恢复原焦点', async () => {
    const records: FakeDriverRecord[] = []
    const moveError = new Error('move failed')
    const onError = vi.fn()
    const focusTarget = document.createElement('button')
    makeVisible(focusTarget)
    document.body.appendChild(focusTarget)
    focusTarget.focus()
    const engine = createEngine(
      vi.fn(() => true),
      records,
      undefined,
      undefined,
      onError,
      undefined,
      { moveTo: moveError },
    )

    await expect(engine.start()).resolves.toBe(true)
    records[0]?.invokeNext()
    await flushPromises()

    expect(onError).toHaveBeenCalledWith(moveError)
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
    expect(document.activeElement).toBe(focusTarget)
  })

  it('Driver 首次销毁异常时重试清理并恢复原焦点', async () => {
    const records: FakeDriverRecord[] = []
    const destroyError = new Error('destroy failed')
    const onError = vi.fn()
    const focusTarget = document.createElement('button')
    makeVisible(focusTarget)
    document.body.appendChild(focusTarget)
    focusTarget.focus()
    const engine = createEngine(
      vi.fn(() => true),
      records,
      undefined,
      undefined,
      onError,
      undefined,
      { destroy: destroyError, destroyFailureCount: 1 },
    )

    await expect(engine.start()).resolves.toBe(true)
    engine.stop()

    expect(onError).toHaveBeenCalledWith(destroyError)
    expect(onError).toHaveBeenCalledOnce()
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
    expect(document.activeElement).toBe(focusTarget)
    expect(records[0]?.active()).toBe(false)
    expect(records[0]?.popover()).toBeNull()
  })

  it('Driver 连续销毁异常时保留实例供后续清理', async () => {
    const records: FakeDriverRecord[] = []
    const destroyError = new Error('destroy failed')
    const onError = vi.fn()
    const engine = createEngine(
      vi.fn(() => true),
      records,
      undefined,
      undefined,
      onError,
      undefined,
      { destroy: destroyError, destroyFailureCount: 2 },
    )

    await expect(engine.start()).resolves.toBe(true)
    engine.stop()

    expect(onError).toHaveBeenCalledTimes(2)
    expect(records[0]?.active()).toBe(true)
    await expect(engine.start()).resolves.toBe(false)

    engine.stop()
    expect(records[0]?.active()).toBe(false)
    expect(records[0]?.popover()).toBeNull()
  })

  it('从未启动的实例停止或销毁时不会转移当前焦点', () => {
    const records: FakeDriverRecord[] = []
    const focusTarget = document.createElement('input')
    const tourTrigger = document.createElement('button')
    tourTrigger.dataset.tour = 'product-tour-trigger'
    makeVisible(focusTarget)
    makeVisible(tourTrigger)
    document.body.append(focusTarget, tourTrigger)
    focusTarget.focus()
    const engine = createEngine(vi.fn(() => true), records)

    engine.stop()
    expect(document.activeElement).toBe(focusTarget)

    engine.dispose()
    expect(document.activeElement).toBe(focusTarget)
    expect(records).toHaveLength(0)
  })

  it('步骤切换与停止都会清理 Popover 装饰', async () => {
    const records: FakeDriverRecord[] = []
    const cleanups: Array<ReturnType<typeof vi.fn>> = []
    const decoratePopover = vi.fn(() => {
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return cleanup
    })
    const engine = createEngine(vi.fn(() => true), records, decoratePopover)

    await expect(engine.start()).resolves.toBe(true)
    expect(decoratePopover).toHaveBeenCalledTimes(1)
    expect(decoratePopover).toHaveBeenNthCalledWith(1, {
      title: records[0]?.popover()?.title,
      closeButton: records[0]?.popover()?.closeButton,
    }, steps[0])

    records[0]?.invokeNext()
    await flushPromises()
    expect(cleanups[0]).toHaveBeenCalledOnce()
    expect(decoratePopover).toHaveBeenCalledTimes(2)
    expect(decoratePopover).toHaveBeenNthCalledWith(2, {
      title: records[0]?.popover()?.title,
      closeButton: records[0]?.popover()?.closeButton,
    }, steps[1])

    engine.stop()
    expect(cleanups[1]).toHaveBeenCalledOnce()
  })

  it('Driver 外部销毁时只清理一次 Popover 装饰', async () => {
    const records: FakeDriverRecord[] = []
    const cleanup = vi.fn()
    const engine = createEngine(vi.fn(() => true), records, vi.fn(() => cleanup))

    await expect(engine.start()).resolves.toBe(true)
    records[0]?.adapter.destroy()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
  })

  it('装饰或清理失败时上报错误并保持向导可销毁', async () => {
    const records: FakeDriverRecord[] = []
    const renderError = new Error('render failed')
    const cleanupError = new Error('cleanup failed')
    const onError = vi.fn()
    const decoratePopover = vi.fn()
      .mockImplementationOnce(() => {
        throw renderError
      })
      .mockImplementationOnce(() => () => {
        throw cleanupError
      })
    const engine = createEngine(
      vi.fn(() => true),
      records,
      decoratePopover,
      undefined,
      onError,
    )

    await expect(engine.start()).resolves.toBe(true)
    expect(onError).toHaveBeenCalledWith(renderError)

    records[0]?.invokeNext()
    await flushPromises()
    records[0]?.adapter.destroy()

    expect(onError).toHaveBeenCalledWith(cleanupError)
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
  })
})

function createEngine(
  prepareStep: ProductTourEngineOptions['prepareStep'],
  records: FakeDriverRecord[],
  decoratePopover?: ProductTourEngineOptions['decoratePopover'],
  beforeHighlighted?: () => void,
  onError = vi.fn(),
  onBlocked = vi.fn(),
  driverFailures?: FakeDriverFailures,
) {
  const engine = new ProductTourEngine({
    steps,
    labels: {
      progress: '{{current}} / {{total}}',
      next: '下一步',
      previous: '上一步',
      done: '完成',
      skip: '跳过',
      close: '关闭',
    },
    styles: {
      popover: 'tour-popover',
      popoverMeta: 'tour-popover-meta',
      skipButton: 'tour-skip',
    },
    completionStore: {
      readCompletedVersion: () => null,
      writeCompletedVersion: () => true,
    },
    prepareStep,
    isBlocked: () => false,
    isTransitionBlocked: () => false,
    onBlocked,
    onError,
    onCompleted: vi.fn(),
    decoratePopover,
    driverFactory: createFakeDriverFactory(records, beforeHighlighted, driverFailures),
  })
  activeEngines.push(engine)
  return engine
}

function createFakeDriverFactory(
  records: FakeDriverRecord[],
  beforeHighlighted?: () => void,
  failures: FakeDriverFailures = {},
): ProductTourDriverFactory {
  return (config) => {
    let active = false
    let index: number | undefined
    let popover: PopoverDOM | null = null
    let remainingDestroyFailures = failures.destroyFailureCount
      ?? (failures.destroy ? Number.POSITIVE_INFINITY : 0)

    const adapter: ProductTourDriverAdapter = {
      drive: (nextIndex = 0) => {
        active = true
        showStep(nextIndex)
      },
      moveTo: (nextIndex) => {
        if (failures.moveTo) {
          throw failures.moveTo
        }
        showStep(nextIndex)
      },
      destroy: () => {
        if (failures.destroy && remainingDestroyFailures > 0) {
          remainingDestroyFailures -= 1
          throw failures.destroy
        }
        if (!active && !popover) {
          return
        }
        active = false
        popover?.wrapper.remove()
        popover = null
        invokeHook(config.onDestroyed, index)
      },
      getActiveIndex: () => index,
    }

    const invokeHook = (hook: DriverHook | undefined, hookIndex: number | undefined) => {
      if (!hook) {
        return
      }
      const step = config.steps?.[hookIndex ?? 0] ?? {}
      hook(undefined, step, {
        config,
        state: { activeIndex: hookIndex },
        driver: adapter as never,
        index: hookIndex,
      })
    }

    const showStep = (nextIndex: number) => {
      invokeHook(
        config.steps?.[nextIndex]?.onHighlightStarted ?? config.onHighlightStarted,
        nextIndex,
      )
      index = nextIndex
      popover?.wrapper.remove()
      popover = createPopover()
      document.body.appendChild(popover.wrapper)
      popover.previousButton.disabled = nextIndex === 0
      config.onPopoverRender?.(popover, {
        config,
        state: { activeIndex: index },
        driver: adapter as never,
        index,
      })
      popover.closeButton.focus()
      beforeHighlighted?.()
      invokeHook(config.steps?.[nextIndex]?.onHighlighted ?? config.onHighlighted, nextIndex)
    }

    const record: FakeDriverRecord = {
      config,
      adapter,
      active: () => active,
      activeIndex: () => index,
      popover: () => popover,
      invokeNext: () => invokeHook(config.onNextClick, index),
      invokePrevious: () => invokeHook(config.onPrevClick, index),
    }
    records.push(record)
    return adapter
  }
}

function createPopover(): PopoverDOM {
  const wrapper = document.createElement('div')
  const arrow = document.createElement('div')
  const title = document.createElement('div')
  const description = document.createElement('div')
  const footer = document.createElement('footer')
  const progress = document.createElement('span')
  const footerButtons = document.createElement('span')
  const previousButton = document.createElement('button')
  const nextButton = document.createElement('button')
  const closeButton = document.createElement('button')
  footerButtons.append(previousButton, nextButton)
  footer.append(progress, footerButtons)
  wrapper.append(closeButton, arrow, title, description, footer)
  return {
    wrapper,
    arrow,
    title,
    description,
    footer,
    progress,
    previousButton,
    nextButton,
    closeButton,
    footerButtons,
  }
}

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function makeVisible(element: HTMLElement) {
  element.getBoundingClientRect = () => new DOMRect(0, 0, 32, 32)
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}
