import { StrictMode, useState, type ReactElement } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App as AntdApp, Button, Dropdown } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config, DriverHook, PopoverDOM } from 'driver.js'
import { ProductTourController, type ProductTourControllerProps } from './ProductTourController.tsx'
import {
  createProductTourDriver,
  type ProductTourDriverAdapter,
  type ProductTourDriverFactory,
} from '../model/productTourDriverAdapter.ts'
import type { ProductTourCompletionStore } from '../model/productTourStorage.ts'
import {
  PRODUCT_TOUR_VERSION,
  buildProductTourSteps,
} from '../model/productTourSteps.ts'

const productTourSteps = buildProductTourSteps((key) => key)
const productTourFinishIndex = productTourSteps.findIndex((step) => step.id === 'finish')

const translationState = vi.hoisted(() => ({ language: 'zh-CN' }))

vi.mock('react-i18next', () => {
  const translate = (key: string, options?: Record<string, unknown>) => (
      key === 'productTour.progress'
        ? `${String(options?.current)} / ${String(options?.total)}`
        : key
  )
  const translations = {
    'zh-CN': translate,
    'en-US': (key: string, options?: Record<string, unknown>) => (
      `en-US:${translate(key, options)}`
    ),
  }
  return {
    useTranslation: () => ({
      i18n: { resolvedLanguage: translationState.language },
      t: translations[translationState.language as keyof typeof translations],
    }),
  }
})

interface FakeDriverRecord {
  config: Config
  adapter: ProductTourDriverAdapter
  activeIndex: () => number | undefined
  destroyCount: () => number
}

function createFakeDriverFactory(records: FakeDriverRecord[]): ProductTourDriverFactory {
  return (config) => {
    let active = false
    let index: number | undefined
    let destroyed = 0
    let popover: PopoverDOM | null = null

    const adapter: ProductTourDriverAdapter = {
      drive: (nextIndex = 0) => {
        active = true
        showStep(nextIndex)
      },
      moveTo: (nextIndex) => showStep(nextIndex),
      destroy: () => {
        if (!active && !popover) {
          return
        }
        active = false
        destroyed += 1
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
      popover.previousButton.classList.toggle('driver-popover-btn-disabled', nextIndex === 0)
      popover.previousButton.textContent = config.prevBtnText ?? ''
      popover.nextButton.textContent = nextIndex === (config.steps?.length ?? 0) - 1
        ? config.doneBtnText ?? ''
        : config.nextBtnText ?? ''
      popover.previousButton.addEventListener('click', () => invokeHook(config.onPrevClick, index))
      popover.nextButton.addEventListener('click', () => invokeHook(
        nextIndex === (config.steps?.length ?? 0) - 1 ? config.onDoneClick : config.onNextClick,
        index,
      ))
      popover.closeButton.addEventListener('click', () => invokeHook(config.onCloseClick, index))
      if (config.onPopoverRender) {
        config.onPopoverRender(popover, {
          config,
          state: { activeIndex: index },
          driver: adapter as never,
          index,
        })
      }
      popover.closeButton.focus()
      invokeHook(config.steps?.[nextIndex]?.onHighlighted ?? config.onHighlighted, nextIndex)
    }

    records.push({
      config,
      adapter,
      activeIndex: () => index,
      destroyCount: () => destroyed,
    })
    return adapter
  }
}

function createRecordingRealDriverFactory(
  records: ProductTourDriverAdapter[],
): ProductTourDriverFactory {
  return (config) => {
    const adapter = createProductTourDriver(config)
    records.push(adapter)
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
  previousButton.type = 'button'
  nextButton.type = 'button'
  closeButton.type = 'button'
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

function installVisibleGeometry() {
  const rect = {
    x: 8,
    y: 8,
    top: 8,
    right: 128,
    bottom: 48,
    left: 8,
    width: 120,
    height: 40,
    toJSON: () => ({}),
  } as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
}

function markVisible(element: Element) {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    right: 44,
    bottom: 44,
    left: 0,
    width: 44,
    height: 44,
    toJSON: () => ({}),
  })
}

function createStore(completedVersion: number | null = null, writeResult = true) {
  const store: ProductTourCompletionStore = {
    readCompletedVersion: vi.fn(() => completedVersion),
    writeCompletedVersion: vi.fn(() => writeResult),
  }
  return store
}

function createProps(overrides: Partial<ProductTourControllerProps> = {}) {
  return {
    ready: true,
    autoStartEligible: true,
    blocked: false,
    manualRequestKey: 0,
    onPrepareStep: vi.fn(() => true),
    onBlocked: vi.fn(),
    onError: vi.fn(),
    completionStore: createStore(),
    ...overrides,
  } satisfies ProductTourControllerProps
}

function renderController(element: ReactElement) {
  return render(element, {
    wrapper: ({ children }) => <>{children}</>,
  })
}

describe('核心使用向导控制器', () => {
  beforeEach(() => {
    translationState.language = 'zh-CN'
    document.body.replaceChildren()
    delete document.body.dataset.termousProductTour
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('空白配置在就绪后自动启动，StrictMode 下只创建一个实例', async () => {
    const records: FakeDriverRecord[] = []
    const onActiveChange = vi.fn()
    const props = createProps({
      completionStore: createStore(),
      driverFactory: createFakeDriverFactory(records),
      onActiveChange,
    })
    renderController(<StrictMode><ProductTourController {...props} /></StrictMode>)

    await waitFor(() => expect(records).toHaveLength(1))
    expect(records[0].activeIndex()).toBe(0)
    expect(document.body).toHaveAttribute('data-termous-product-tour', 'true')
    expect(onActiveChange.mock.calls).toEqual([[true]])
  })

  it.each([
    { label: '已有数据', autoStartEligible: false, completedVersion: null },
    { label: '已完成版本', autoStartEligible: true, completedVersion: PRODUCT_TOUR_VERSION },
  ])('$label 不自动启动，但手动请求仍可重播', async ({
    autoStartEligible,
    completedVersion,
  }) => {
    const records: FakeDriverRecord[] = []
    const props = createProps({
      autoStartEligible,
      completionStore: createStore(completedVersion),
      driverFactory: createFakeDriverFactory(records),
    })
    const view = renderController(<ProductTourController {...props} />)
    await act(async () => undefined)
    expect(records).toHaveLength(0)

    view.rerender(<ProductTourController {...props} manualRequestKey={1} />)
    await waitFor(() => expect(records).toHaveLength(1))
  })

  it('旧版完成记录不会阻止新版向导自动展示', async () => {
    const records: FakeDriverRecord[] = []
    renderController(<ProductTourController {...createProps({
      completionStore: createStore(PRODUCT_TOUR_VERSION - 1),
      driverFactory: createFakeDriverFactory(records),
    })} />)

    await waitFor(() => expect(records).toHaveLength(1))
    expect(records[0].activeIndex()).toBe(0)
  })

  it('首次就绪时已有数据，之后删空数据也不会在会话中途自动启动', async () => {
    const records: FakeDriverRecord[] = []
    const props = createProps({
      autoStartEligible: false,
      driverFactory: createFakeDriverFactory(records),
    })
    const view = renderController(<ProductTourController {...props} />)
    await act(async () => undefined)

    view.rerender(<ProductTourController {...props} autoStartEligible />)
    await act(async () => undefined)

    expect(records).toHaveLength(0)
  })

  it('StrictMode 首次挂载即可消费非零手动请求', async () => {
    const records: FakeDriverRecord[] = []
    const props = createProps({
      autoStartEligible: false,
      manualRequestKey: 1,
      driverFactory: createFakeDriverFactory(records),
    })

    renderController(<StrictMode><ProductTourController {...props} /></StrictMode>)

    await waitFor(() => expect(records).toHaveLength(1))
    expect(records[0].activeIndex()).toBe(0)
  })

  it('忙碌或脏状态阻止手动启动并给出提示', async () => {
    const records: FakeDriverRecord[] = []
    const onBlocked = vi.fn()
    const props = createProps({
      blocked: true,
      autoStartEligible: false,
      onBlocked,
      driverFactory: createFakeDriverFactory(records),
    })
    const view = renderController(<ProductTourController {...props} />)
    view.rerender(<ProductTourController {...props} manualRequestKey={1} />)

    await waitFor(() => expect(onBlocked).toHaveBeenCalledTimes(1))
    expect(records).toHaveLength(0)
  })

  it('异步启动准备完成后会重新检查阻塞状态', async () => {
    const records: FakeDriverRecord[] = []
    let resolvePreparation!: () => void
    const onBlocked = vi.fn()
    const onPrepareStep = vi.fn(() => new Promise<void>((resolve) => {
      resolvePreparation = resolve
    }))
    const props = createProps({
      autoStartEligible: false,
      manualRequestKey: 1,
      onBlocked,
      onPrepareStep,
      driverFactory: createFakeDriverFactory(records),
    })
    const view = renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(onPrepareStep).toHaveBeenCalledOnce())

    view.rerender(<ProductTourController {...props} blocked />)
    await act(async () => resolvePreparation())

    await waitFor(() => expect(onBlocked).toHaveBeenCalledOnce())
    expect(records).toHaveLength(0)
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
  })

  it('启动准备被最新门禁拒绝时给出提示', async () => {
    const records: FakeDriverRecord[] = []
    const onBlocked = vi.fn()
    renderController(<ProductTourController {...createProps({
      autoStartEligible: false,
      manualRequestKey: 1,
      onBlocked,
      onPrepareStep: vi.fn(() => false),
      driverFactory: createFakeDriverFactory(records),
    })} />)

    await waitFor(() => expect(onBlocked).toHaveBeenCalledOnce())
    expect(records).toHaveLength(0)
  })

  it('自动启动资格失效会取消仍在准备的尝试', async () => {
    const records: FakeDriverRecord[] = []
    let resolvePreparation!: () => void
    const onPrepareStep = vi.fn(() => new Promise<void>((resolve) => {
      resolvePreparation = resolve
    }))
    const props = createProps({
      onPrepareStep,
      driverFactory: createFakeDriverFactory(records),
    })
    const view = renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(onPrepareStep).toHaveBeenCalledOnce())

    view.rerender(<ProductTourController {...props} autoStartEligible={false} />)
    await act(async () => resolvePreparation())

    expect(records).toHaveLength(0)
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
  })

  it('迁移门禁允许编辑器内讲解，并阻止跨路由或返回目录', async () => {
    const records: FakeDriverRecord[] = []
    const onBlocked = vi.fn()
    const onPrepareStep = vi.fn(() => true)
    const vaultWorkspace = document.createElement('section')
    vaultWorkspace.dataset.activeView = 'editor'
    const credentialEditor = document.createElement('section')
    credentialEditor.dataset.tour = 'credential-editor'
    const credentialBack = document.createElement('button')
    credentialBack.dataset.tour = 'credential-back'
    const onCredentialBack = vi.fn()
    credentialBack.addEventListener('click', onCredentialBack)
    vaultWorkspace.append(credentialEditor, credentialBack)
    const hostWorkspace = document.createElement('section')
    hostWorkspace.dataset.activeView = 'editor'
    const hostEditor = document.createElement('section')
    hostEditor.dataset.tour = 'host-editor'
    const connectionCatalog = document.createElement('section')
    connectionCatalog.dataset.tour = 'host-connection-catalog'
    const hostBack = document.createElement('button')
    hostBack.dataset.tour = 'host-back'
    const onHostBack = vi.fn()
    hostBack.addEventListener('click', onHostBack)
    hostEditor.appendChild(connectionCatalog)
    hostWorkspace.append(hostEditor, hostBack)
    document.body.append(vaultWorkspace, hostWorkspace)
    const props = createProps({
      onBlocked,
      onPrepareStep,
      isTransitionBlocked: (currentStep, nextStep) => (
        nextStep.preparation === 'vaultCatalog'
        || nextStep.preparation === 'hostCatalog'
        || currentStep.route !== nextStep.route
      ),
      driverFactory: createFakeDriverFactory(records),
    })
    renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))

    act(() => records[0].adapter.moveTo(2))
    act(() => invokeConfigHook(records[0], 'next'))
    await waitFor(() => expect(records[0].activeIndex()).toBe(3))

    act(() => invokeConfigHook(records[0], 'previous'))
    expect(records[0].activeIndex()).toBe(3)
    expect(onCredentialBack).not.toHaveBeenCalled()
    expect(onBlocked).toHaveBeenCalledTimes(1)

    act(() => invokeConfigHook(records[0], 'next'))
    expect(records[0].activeIndex()).toBe(3)
    expect(onBlocked).toHaveBeenCalledTimes(2)

    act(() => records[0].adapter.moveTo(5))
    act(() => invokeConfigHook(records[0], 'previous'))
    expect(records[0].activeIndex()).toBe(5)
    expect(onHostBack).not.toHaveBeenCalled()
    expect(onBlocked).toHaveBeenCalledTimes(3)

    act(() => invokeConfigHook(records[0], 'next'))
    await waitFor(() => expect(records[0].activeIndex()).toBe(6))

    act(() => invokeConfigHook(records[0], 'next'))
    expect(records[0].activeIndex()).toBe(6)
    expect(onBlocked).toHaveBeenCalledTimes(4)
    vaultWorkspace.remove()
    hostWorkspace.remove()
  })

  it('串行化重复前进请求并支持沿同一状态机后退', async () => {
    const records: FakeDriverRecord[] = []
    let resolveNavigation!: () => void
    const onPrepareStep = vi.fn((step: { id: string }) => (
      step.id === 'vaultNav'
        ? new Promise<void>((resolve) => {
            resolveNavigation = resolve
          })
        : true
    ))
    const props = createProps({
      onPrepareStep,
      driverFactory: createFakeDriverFactory(records),
    })
    renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))

    act(() => {
      invokeConfigHook(records[0], 'next')
      invokeConfigHook(records[0], 'next')
    })
    expect(onPrepareStep).toHaveBeenCalledTimes(2)
    await act(async () => resolveNavigation())
    await waitFor(() => expect(records[0].activeIndex()).toBe(1))

    act(() => invokeConfigHook(records[0], 'previous'))
    await waitFor(() => expect(records[0].activeIndex()).toBe(0))
  })

  it('步骤迁移准备被最新门禁拒绝时停留并给出提示', async () => {
    const records: FakeDriverRecord[] = []
    const onBlocked = vi.fn()
    const onPrepareStep = vi.fn((step: { id: string }) => step.id === 'welcome')
    renderController(<ProductTourController {...createProps({
      onBlocked,
      onPrepareStep,
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))

    act(() => invokeConfigHook(records[0], 'next'))

    await waitFor(() => expect(onBlocked).toHaveBeenCalledOnce())
    expect(records[0].activeIndex()).toBe(0)
  })

  it('完整十五步流程不产生直接网络请求或隐式提交', async () => {
    const records: FakeDriverRecord[] = []
    const completionStore = createStore()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fixture = installPreparedTourTargets()
    const onPrepareStep = vi.fn(() => true)
    renderController(<ProductTourController {...createProps({
      completionStore,
      onPrepareStep,
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))

    const stepCount = records[0].config.steps?.length ?? 0
    for (let index = 1; index < stepCount; index += 1) {
      act(() => invokeConfigHook(records[0], 'next'))
      await waitFor(() => expect(records[0].activeIndex()).toBe(index))
    }
    fireEvent.click(screen.getByRole('button', { name: 'productTour.done' }))

    expect(onPrepareStep).toHaveBeenCalledTimes(stepCount)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(completionStore.writeCompletedVersion).toHaveBeenCalledOnce()
    fixture.remove()
  })

  it('完成状态存储异常时上报错误并完整清理向导', async () => {
    const records: FakeDriverRecord[] = []
    const persistenceError = new Error('storage failed')
    const completionStore = createStore()
    const onError = vi.fn()
    completionStore.writeCompletedVersion = vi.fn(() => {
      throw persistenceError
    })
    renderController(<ProductTourController {...createProps({
      completionStore,
      onError,
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'productTour.skip' }))

    expect(onError).toHaveBeenCalledExactlyOnceWith(persistenceError)
    expect(records[0].destroyCount()).toBe(1)
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
  })

  it('输入控件聚焦时不拦截方向键和 Enter，普通焦点可用方向键导航', async () => {
    const records: FakeDriverRecord[] = []
    const props = createProps({ driverFactory: createFakeDriverFactory(records) })
    renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))
    const input = document.createElement('input')
    document.body.appendChild(input)

    fireEvent.keyDown(input, { key: 'ArrowRight' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(records[0].activeIndex()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'productTour.next' }))
    await waitFor(() => expect(records[0].activeIndex()).toBe(1))
    input.remove()
  })

  it('复合交互控件聚焦时不抢占方向键和 Enter', async () => {
    const records: FakeDriverRecord[] = []
    const props = createProps({ driverFactory: createFakeDriverFactory(records) })
    renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))

    const controls = ['combobox', 'tab', 'slider'].map((role) => {
      const control = document.createElement('div')
      control.setAttribute('role', role)
      control.tabIndex = 0
      document.body.appendChild(control)
      return control
    })

    controls.forEach((control) => {
      fireEvent.keyDown(control, { key: 'ArrowLeft' })
      fireEvent.keyDown(control, { key: 'ArrowRight' })
      fireEvent.keyDown(control, { key: 'Enter' })
    })

    expect(records[0].activeIndex()).toBe(0)
    controls.forEach((control) => control.remove())
  })

  it('首步解锁后仍保留 Driver 的上一步禁用状态', async () => {
    const records: FakeDriverRecord[] = []
    renderController(<ProductTourController {...createProps({
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))

    expect(screen.getByRole('button', { name: 'productTour.previous' })).toBeDisabled()
  })

  it('首步与跨页步骤默认聚焦下一步而不是关闭按钮', async () => {
    const records: FakeDriverRecord[] = []
    renderController(<ProductTourController {...createProps({
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'productTour.next' }))
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'productTour.close' }))

    fireEvent.click(screen.getByRole('button', { name: 'productTour.next' }))
    await waitFor(() => expect(records[0].activeIndex()).toBe(1))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'productTour.next' }))
  })

  it('真实 Driver 在首步和切步后聚焦主操作按钮', async () => {
    installVisibleGeometry()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const drivers: ProductTourDriverAdapter[] = []
    const vaultNav = document.createElement('button')
    vaultNav.dataset.tour = 'nav-vault'
    document.body.appendChild(vaultNav)
    renderController(<ProductTourController {...createProps({
      driverFactory: createRecordingRealDriverFactory(drivers),
    })} />)

    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'productTour.next' }),
    ))
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: 'productTour.close' }),
    )

    act(() => drivers[0]?.moveTo(1))
    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="vaultNav"]'),
    ).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'productTour.next' }),
    ))
    vaultNav.remove()
  })

  it('高层 Portal 打开时完全让出键盘控制', async () => {
    const records: FakeDriverRecord[] = []
    const store = createStore()
    renderController(<ProductTourController {...createProps({
      completionStore: store,
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))
    const modalRoot = document.createElement('div')
    modalRoot.className = 'ant-modal-root'
    const modalButton = document.createElement('button')
    modalRoot.appendChild(modalButton)
    document.body.appendChild(modalRoot)
    modalButton.focus()

    fireEvent.keyDown(modalButton, { key: 'Escape' })
    fireEvent.keyDown(modalButton, { key: 'ArrowRight' })
    fireEvent.keyDown(modalButton, { key: 'Enter' })
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    expect(modalButton.dispatchEvent(tabEvent)).toBe(true)

    expect(records[0].activeIndex()).toBe(0)
    expect(records[0].destroyCount()).toBe(0)
    expect(store.writeCompletedVersion).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(modalButton)
    modalRoot.remove()
  })

  it('真实 Driver 的 Tab 循环可到达密码框和组合选择输入', async () => {
    installVisibleGeometry()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const drivers: ProductTourDriverAdapter[] = []
    const target = document.createElement('section')
    target.dataset.tour = 'nav-vault'
    const password = document.createElement('input')
    password.type = 'password'
    const combobox = document.createElement('input')
    combobox.type = 'search'
    combobox.setAttribute('role', 'combobox')
    target.append(password, combobox)
    document.body.appendChild(target)
    renderController(<ProductTourController {...createProps({
      driverFactory: createRecordingRealDriverFactory(drivers),
    })} />)
    await waitFor(() => expect(document.querySelector('.driver-popover')).not.toBeNull())

    act(() => drivers[0]?.moveTo(1))
    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="vaultNav"]'),
    ).not.toBeNull())

    const visited = new Set<Element | null>()
    for (let index = 0; index < 8; index += 1) {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' })
      visited.add(document.activeElement)
    }

    expect(visited.has(password)).toBe(true)
    expect(visited.has(combobox)).toBe(true)
    target.remove()
  })

  it('真实 Driver 不会从高层 Modal 抢走 Tab 焦点', async () => {
    installVisibleGeometry()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    renderController(<ProductTourController {...createProps()} />)
    await waitFor(() => expect(document.querySelector('.driver-popover')).not.toBeNull())
    const modalRoot = document.createElement('div')
    modalRoot.className = 'ant-modal-root'
    const modalButton = document.createElement('button')
    modalRoot.appendChild(modalButton)
    document.body.appendChild(modalRoot)
    modalButton.focus()
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })

    expect(modalButton.dispatchEvent(tabEvent)).toBe(true)
    expect(document.activeElement).toBe(modalButton)
    modalRoot.remove()
  })

  it('真实 Driver 会让可见的 Ant Dropdown 最终接管 Tab 焦点', async () => {
    installVisibleGeometry()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))

    function DropdownHarness() {
      const [open, setOpen] = useState(false)
      return (
        <AntdApp>
          <div className="ant-modal-root">
            <Dropdown
              open={open}
              onOpenChange={setOpen}
              trigger={['click']}
              menu={{ items: [{ key: 'tour', label: '使用向导' }] }}
            >
              <Button aria-label="帮助">帮助</Button>
            </Dropdown>
          </div>
          <ProductTourController {...createProps()} />
        </AntdApp>
      )
    }

    renderController(<DropdownHarness />)
    await waitFor(() => expect(document.querySelector('.driver-popover')).not.toBeNull())
    const trigger = screen.getByRole('button', { name: '帮助' })
    fireEvent.click(trigger)
    await waitFor(() => expect(
      document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)'),
    ).not.toBeNull())
    trigger.focus()

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      keyCode: 9,
      bubbles: true,
      cancelable: true,
    })
    expect(trigger.dispatchEvent(tabEvent)).toBe(false)
    await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true))
  })

  it('真实 Driver 销毁后不会移除帮助按钮自身的菜单语义', async () => {
    installVisibleGeometry()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const drivers: ProductTourDriverAdapter[] = []
    const triggerAnchor = document.createElement('span')
    triggerAnchor.dataset.tour = 'product-tour-trigger'
    const triggerButton = document.createElement('button')
    triggerButton.setAttribute('aria-haspopup', 'menu')
    triggerButton.setAttribute('aria-expanded', 'false')
    triggerAnchor.appendChild(triggerButton)
    document.body.appendChild(triggerAnchor)
    triggerButton.focus()
    renderController(<ProductTourController {...createProps({
      driverFactory: createRecordingRealDriverFactory(drivers),
    })} />)
    await waitFor(() => expect(document.querySelector('.driver-popover')).not.toBeNull())

    act(() => drivers[0]?.moveTo(productTourFinishIndex))
    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="finish"]'),
    ).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'productTour.skip' }))

    expect(triggerButton).toHaveAttribute('aria-haspopup', 'menu')
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(triggerButton)
    triggerAnchor.remove()
  })

  it('关闭后把焦点恢复到启动前的帮助入口', async () => {
    const records: FakeDriverRecord[] = []
    const trigger = document.createElement('button')
    trigger.dataset.tour = 'product-tour-trigger'
    markVisible(trigger)
    document.body.appendChild(trigger)
    trigger.focus()
    renderController(<ProductTourController {...createProps({
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))
    expect(document.activeElement).not.toBe(trigger)

    fireEvent.click(screen.getByRole('button', { name: 'productTour.skip' }))

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('真实 Driver 完成销毁后再恢复启动入口焦点', async () => {
    installVisibleGeometry()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const drivers: ProductTourDriverAdapter[] = []
    const trigger = document.createElement('button')
    trigger.dataset.tour = 'product-tour-trigger'
    const vaultNav = document.createElement('button')
    vaultNav.dataset.tour = 'nav-vault'
    const vaultCatalog = document.createElement('section')
    vaultCatalog.dataset.activeView = 'catalog'
    const vaultActions = document.createElement('div')
    vaultActions.dataset.tour = 'vault-actions'
    vaultCatalog.appendChild(vaultActions)
    document.body.append(trigger, vaultNav, vaultCatalog)
    trigger.focus()
    renderController(<ProductTourController {...createProps({
      driverFactory: createRecordingRealDriverFactory(drivers),
    })} />)
    await waitFor(() => expect(document.querySelector('.driver-popover')).not.toBeNull())

    act(() => drivers[0]?.moveTo(1))
    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="vaultNav"]'),
    ).not.toBeNull())
    vaultNav.focus()
    act(() => drivers[0]?.moveTo(2))
    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="vaultActions"]'),
    ).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'productTour.skip' }))

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
    vaultNav.remove()
    vaultCatalog.remove()
  })

  it('减少动态效果偏好会关闭 Driver 动画和平滑滚动', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const records: FakeDriverRecord[] = []
    renderController(<ProductTourController {...createProps({
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))

    expect(records[0].config.animate).toBe(false)
    expect(records[0].config.duration).toBe(0)
    expect(records[0].config.smoothScroll).toBe(false)
  })

  it('多个同名锚点中只向 Driver 返回实际可见的节点', async () => {
    const records: FakeDriverRecord[] = []
    renderController(<ProductTourController {...createProps({
      driverFactory: createFakeDriverFactory(records),
    })} />)
    await waitFor(() => expect(records).toHaveLength(1))
    const hidden = document.createElement('button')
    const visible = document.createElement('button')
    hidden.dataset.tour = 'nav-vault'
    visible.dataset.tour = 'nav-vault'
    visible.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      right: 44,
      bottom: 44,
      left: 0,
      width: 44,
      height: 44,
      toJSON: () => ({}),
    })
    document.body.append(hidden, visible)

    const resolver = records[0].config.steps?.[1]?.element
    expect(typeof resolver).toBe('function')
    expect((resolver as () => Element)()).toBe(visible)
    hidden.remove()
    visible.remove()
  })

  it('完成、跳过和主动关闭写入当前版本，异常卸载不写入', async () => {
    const records: FakeDriverRecord[] = []
    const store = createStore()
    const onActiveChange = vi.fn()
    const props = createProps({
      completionStore: store,
      driverFactory: createFakeDriverFactory(records),
      onActiveChange,
    })
    const view = renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'productTour.skip' }))
    expect(store.writeCompletedVersion).toHaveBeenCalledWith(PRODUCT_TOUR_VERSION)
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')

    view.rerender(<ProductTourController {...props} manualRequestKey={1} />)
    await waitFor(() => expect(records).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'productTour.close' }))
    expect(store.writeCompletedVersion).toHaveBeenCalledTimes(2)

    view.rerender(<ProductTourController {...props} manualRequestKey={2} />)
    await waitFor(() => expect(records).toHaveLength(3))
    act(() => records[2].adapter.moveTo((records[2].config.steps?.length ?? 1) - 1))
    fireEvent.click(screen.getByRole('button', { name: 'productTour.done' }))
    expect(store.writeCompletedVersion).toHaveBeenCalledTimes(3)

    view.rerender(<ProductTourController {...props} manualRequestKey={3} />)
    await waitFor(() => expect(records).toHaveLength(4))
    view.unmount()
    expect(store.writeCompletedVersion).toHaveBeenCalledTimes(3)
    expect(records[3].destroyCount()).toBe(1)
    expect(onActiveChange.mock.calls).toEqual([
      [true], [false],
      [true], [false],
      [true], [false],
      [true], [false],
    ])
  })

  it('存储写入失败时仍在当前渲染会话内防止自动重复启动', async () => {
    const records: FakeDriverRecord[] = []
    const store = createStore(null, false)
    const props = createProps({
      completionStore: store,
      driverFactory: createFakeDriverFactory(records),
    })
    const view = renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'productTour.skip' }))

    view.rerender(<ProductTourController {...props} ready={false} />)
    view.rerender(<ProductTourController {...props} ready />)
    await act(async () => undefined)
    expect(records).toHaveLength(1)
  })

  it('活动期间切换语言不中断向导，并在下次重播使用新文案', async () => {
    const records: FakeDriverRecord[] = []
    const store = createStore()
    const props = createProps({
      completionStore: store,
      driverFactory: createFakeDriverFactory(records),
    })
    const view = renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))

    translationState.language = 'en-US'
    view.rerender(<ProductTourController {...props} />)

    expect(records).toHaveLength(1)
    expect(records[0].destroyCount()).toBe(0)
    expect(records[0].activeIndex()).toBe(0)
    expect(store.writeCompletedVersion).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'productTour.close' }))
    expect(records[0].destroyCount()).toBe(1)

    view.rerender(<ProductTourController {...props} manualRequestKey={1} />)
    await waitFor(() => expect(records).toHaveLength(2))
    expect(records[1].config.steps?.[0]?.popover?.title).toBe(
      'en-US:productTour.steps.welcome.title',
    )
  })

  it('Core 不可用时销毁实例并清理 body 状态', async () => {
    const records: FakeDriverRecord[] = []
    const onActiveChange = vi.fn()
    const props = createProps({
      driverFactory: createFakeDriverFactory(records),
      onActiveChange,
    })
    const view = renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))

    view.rerender(<ProductTourController {...props} ready={false} blocked />)
    await waitFor(() => expect(records[0].destroyCount()).toBe(1))
    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
    expect(onActiveChange.mock.calls).toEqual([[true], [false]])
  })

  it('Driver 外部销毁时同步结束活动状态', async () => {
    const records: FakeDriverRecord[] = []
    const onActiveChange = vi.fn()
    renderController(<ProductTourController {...createProps({
      driverFactory: createFakeDriverFactory(records),
      onActiveChange,
    })} />)
    await waitFor(() => expect(onActiveChange).toHaveBeenLastCalledWith(true))

    act(() => records[0].adapter.destroy())

    expect(document.body).not.toHaveAttribute('data-termous-product-tour')
    expect(onActiveChange.mock.calls).toEqual([[true], [false]])
  })

  it('为缺失目标保留等待和居中降级配置', async () => {
    const records: FakeDriverRecord[] = []
    const props = createProps({ driverFactory: createFakeDriverFactory(records) })
    renderController(<ProductTourController {...props} />)
    await waitFor(() => expect(records).toHaveLength(1))

    expect(records[0].config.steps).toHaveLength(productTourSteps.length)
    expect(records[0].config.steps?.every((step) => (
      step.waitForElement === 2500 && step.skipMissingElement === false
    ))).toBe(true)
  })

  it('真实 Driver 在目标缺失时居中说明且不跳过当前步骤', async () => {
    installVisibleGeometry()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const drivers: ProductTourDriverAdapter[] = []
    renderController(<ProductTourController {...createProps({
      driverFactory: createRecordingRealDriverFactory(drivers),
    })} />)
    await waitFor(() => expect(
      document.querySelector('.driver-popover'),
    ).toHaveAttribute('aria-busy', 'false'))

    fireEvent.click(screen.getByRole('button', { name: 'productTour.next' }))

    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="vaultNav"]'),
    ).not.toBeNull(), { timeout: 3500 })
    expect(document.querySelector('#driver-dummy-element')).not.toBeNull()
    expect(document.querySelector('.driver-popover-side-over')).not.toBeNull()
    expect(drivers[0]?.getActiveIndex()).toBe(1)
    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="vaultNav"]'),
    ).toHaveAttribute('aria-busy', 'false'))

    fireEvent.click(screen.getByRole('button', { name: 'productTour.previous' }))
    await waitFor(() => expect(
      document.querySelector('[data-product-tour-step="welcome"]'),
    ).not.toBeNull())
  })
})

function invokeConfigHook(record: FakeDriverRecord, action: 'next' | 'previous') {
  const hook = action === 'next' ? record.config.onNextClick : record.config.onPrevClick
  if (!hook) {
    return
  }
  const index = record.activeIndex() ?? 0
  const step = record.config.steps?.[index] ?? {}
  hook(undefined, step, {
    config: record.config,
    state: { activeIndex: index },
    driver: record.adapter as never,
    index,
  })
}

function installPreparedTourTargets() {
  const fixture = document.createElement('div')

  const vaultCatalog = document.createElement('section')
  vaultCatalog.dataset.activeView = 'catalog'
  const vaultActions = document.createElement('div')
  vaultActions.dataset.tour = 'vault-actions'
  vaultCatalog.appendChild(vaultActions)

  const vaultEditor = document.createElement('section')
  vaultEditor.dataset.activeView = 'editor'
  const credentialEditor = document.createElement('section')
  credentialEditor.dataset.tour = 'credential-editor'
  vaultEditor.appendChild(credentialEditor)

  const hostCatalog = document.createElement('section')
  hostCatalog.dataset.activeView = 'catalog'
  const hostAdd = document.createElement('button')
  hostAdd.dataset.tour = 'hosts-add'
  hostCatalog.appendChild(hostAdd)

  const hostWorkspace = document.createElement('section')
  hostWorkspace.dataset.activeView = 'editor'
  const hostEditor = document.createElement('section')
  hostEditor.dataset.tour = 'host-editor'
  const assetForm = document.createElement('div')
  assetForm.dataset.tour = 'host-asset-form'
  const connectionCatalog = document.createElement('div')
  connectionCatalog.dataset.tour = 'host-connection-catalog'
  hostEditor.append(assetForm, connectionCatalog)
  hostWorkspace.appendChild(hostEditor)

  fixture.append(vaultCatalog, vaultEditor, hostCatalog, hostWorkspace)
  document.body.appendChild(fixture)
  return fixture
}
