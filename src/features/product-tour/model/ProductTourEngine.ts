import type { Config, PopoverDOM } from 'driver.js'
import {
  createProductTourDriver,
  type ProductTourDriverAdapter,
  type ProductTourDriverFactory,
} from './productTourDriverAdapter.ts'
import {
  PRODUCT_TOUR_VERSION,
  type ProductTourLabels,
  type ProductTourStep,
} from './productTourSteps.ts'
import type { ProductTourCompletionStore } from './productTourStorage.ts'

type ProductTourCompletionReason = 'completed' | 'skipped' | 'closed'

type ProductTourPreparationOutcome = 'ready' | 'blocked' | 'cancelled' | 'failed'

interface ProductTourStyleClasses {
  popover: string
  popoverMeta: string
  skipButton: string
}

interface ProductTourContent {
  steps: ProductTourStep[]
  labels: ProductTourLabels
}

export interface ProductTourEngineOptions {
  steps: ProductTourStep[]
  labels: ProductTourLabels
  styles: ProductTourStyleClasses
  completionStore: ProductTourCompletionStore
  prepareStep: (step: ProductTourStep, signal: AbortSignal) => boolean | void | Promise<boolean | void>
  isBlocked: () => boolean
  isTransitionBlocked: (currentStep: ProductTourStep, nextStep: ProductTourStep) => boolean
  onBlocked: () => void
  onError: (error: unknown) => void
  onActiveChange: (active: boolean) => void
  onCompleted: (reason: ProductTourCompletionReason, persisted: boolean) => void
  decoratePopover?: (
    target: Pick<PopoverDOM, 'title' | 'closeButton'>,
    step: ProductTourStep,
  ) => void | (() => void)
  driverFactory?: ProductTourDriverFactory
}

export class ProductTourEngine {
  private readonly options: ProductTourEngineOptions
  private readonly driverFactory: ProductTourDriverFactory
  private content: ProductTourContent
  private pendingContent: ProductTourContent | null = null
  private driver: ProductTourDriverAdapter | null = null
  private cleanupDriver: ProductTourDriverAdapter | null = null
  private activePopover: PopoverDOM | null = null
  private activePopoverDisabledState: { previous: boolean; next: boolean } | null = null
  private popoverDecorationCleanup: (() => void) | null = null
  private initialFocus: HTMLElement | null = null
  private focusRestorationArmed = false
  private preparationController: AbortController | null = null
  private generation = 0
  private transitionLocked = false
  private starting = false
  private active = false
  private disposed = false

  constructor(options: ProductTourEngineOptions) {
    this.options = options
    this.driverFactory = options.driverFactory ?? createProductTourDriver
    this.content = {
      steps: options.steps,
      labels: options.labels,
    }
  }

  updateContent(steps: ProductTourStep[], labels: ProductTourLabels) {
    if (this.disposed) {
      return
    }
    const content = { steps, labels }
    // 活动 Driver 的配置必须与步骤索引保持一致，文案更新延迟到本轮结束。
    if (this.driver || this.cleanupDriver || this.starting || this.active) {
      this.pendingContent = content
      return
    }
    this.content = content
  }

  async start(signal?: AbortSignal) {
    if (
      signal?.aborted
      || this.disposed
      || this.starting
      || this.driver
      || this.cleanupDriver
    ) {
      return false
    }
    if (this.options.isBlocked()) {
      this.options.onBlocked()
      return false
    }

    this.starting = true
    this.transitionLocked = true
    const generation = this.generation + 1
    this.generation = generation
    const controller = this.replacePreparationController()
    const abortPreparation = () => controller.abort()
    signal?.addEventListener('abort', abortPreparation, { once: true })
    const preparation = await this.prepareStep(0, controller.signal, generation)
    signal?.removeEventListener('abort', abortPreparation)
    const prepared = preparation === 'ready'
    const preparationRejected = preparation === 'blocked'
      && !signal?.aborted
      && !this.disposed
      && !controller.signal.aborted
      && generation === this.generation
    if (
      !prepared
      || signal?.aborted
      || this.disposed
      || controller.signal.aborted
      || generation !== this.generation
    ) {
      if (generation === this.generation) {
        this.starting = false
        if (preparationRejected) {
          this.options.onBlocked()
        }
        this.releaseTransition()
        this.applyPendingContent()
      }
      return false
    }
    if (this.options.isBlocked()) {
      this.starting = false
      this.options.onBlocked()
      this.releaseTransition()
      this.applyPendingContent()
      return false
    }

    try {
      this.initialFocus = resolveFocusReturnTarget()
      this.focusRestorationArmed = true
      document.body.dataset.termousProductTour = 'true'
      window.addEventListener('keydown', this.handleKeyDown)
      this.driver = this.driverFactory(this.createDriverConfig())
      this.driver.drive(0)
      if (!this.driver) {
        this.starting = false
        return false
      }
      this.setActive(true)
      this.starting = false
      return true
    } catch (error) {
      this.starting = false
      try {
        this.options.onError(error)
      } finally {
        this.stop()
      }
      return false
    }
  }

  stop() {
    const focusTarget = this.initialFocus
    const shouldRestoreFocus = this.focusRestorationArmed
    this.initialFocus = null
    this.focusRestorationArmed = false
    this.generation += 1
    this.preparationController?.abort()
    this.preparationController = null
    this.starting = false
    this.setTransitionState(false)
    window.removeEventListener('keydown', this.handleKeyDown)
    delete document.body.dataset.termousProductTour

    const activeDriver = this.driver ?? this.cleanupDriver
    let driverDestroyed = !activeDriver
    this.activePopover = null
    this.activePopoverDisabledState = null
    try {
      this.clearPopoverDecoration()
      if (activeDriver) {
        try {
          this.destroyDriver(activeDriver)
          driverDestroyed = true
        } catch (error) {
          this.options.onError(error)
          if (this.driver === activeDriver || this.cleanupDriver === activeDriver) {
            try {
              this.destroyDriver(activeDriver)
              driverDestroyed = true
            } catch (retryError) {
              this.options.onError(retryError)
            }
          }
        }
      }
    } finally {
      if (
        !driverDestroyed
        && activeDriver
        && (this.driver === activeDriver || this.cleanupDriver === activeDriver)
      ) {
        if (this.driver === activeDriver) {
          this.driver = null
        }
        this.cleanupDriver = activeDriver
      }
      this.setActive(false)
      if (!this.cleanupDriver) {
        this.applyPendingContent()
      }
      if (shouldRestoreFocus) {
        restoreFocusTarget(focusTarget)
      }
    }
  }

  dispose() {
    this.disposed = true
    this.stop()
    if (this.cleanupDriver) {
      this.stop()
    }
  }

  private destroyDriver(driver: ProductTourDriverAdapter) {
    driver.destroy()
    if (this.driver === driver) {
      this.driver = null
    }
    if (this.cleanupDriver === driver) {
      this.cleanupDriver = null
    }
  }

  private createDriverConfig(): Config {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    return {
      steps: this.content.steps.map((step, index) => ({
        element: step.element
          ? () => findVisibleTourTarget(step.element!) as Element
          : undefined,
        waitForElement: 2500,
        skipMissingElement: false,
        disableActiveInteraction: false,
        onHighlightStarted: () => this.clearPopoverDecoration(),
        onHighlighted: () => this.releaseTransition(index),
        popover: {
          title: step.title,
          description: step.description,
          side: step.side,
          align: step.align,
        },
      })),
      animate: !reduceMotion,
      duration: reduceMotion ? 0 : 260,
      smoothScroll: !reduceMotion,
      allowScroll: true,
      allowClose: true,
      allowKeyboardControl: false,
      overlayColor: '#05070a',
      overlayOpacity: 0.72,
      overlayClickBehavior: () => this.finish('closed'),
      stagePadding: 8,
      stageRadius: 8,
      popoverOffset: 12,
      popoverClass: this.options.styles.popover,
      showButtons: ['next', 'previous', 'close'],
      showProgress: true,
      progressText: this.content.labels.progress,
      nextBtnText: this.content.labels.next,
      prevBtnText: this.content.labels.previous,
      doneBtnText: this.content.labels.done,
      onNextClick: () => void this.moveBy(1),
      onPrevClick: () => void this.moveBy(-1),
      onDoneClick: () => this.finish('completed'),
      onCloseClick: () => this.finish('closed'),
      onPopoverRender: (popover, context) => this.renderPopover(popover, context.index),
      onDestroyed: () => this.handleDriverDestroyed(),
    }
  }

  private async moveBy(offset: -1 | 1) {
    const activeIndex = this.driver?.getActiveIndex()
    if (activeIndex === undefined || this.transitionLocked || this.disposed) {
      return
    }
    const nextIndex = activeIndex + offset
    if (nextIndex >= this.content.steps.length) {
      this.finish('completed')
      return
    }
    const currentStep = this.content.steps[activeIndex]
    const nextStep = this.content.steps[nextIndex]
    if (
      nextIndex < 0
      || !currentStep
      || !nextStep
      || this.options.isBlocked()
      || this.options.isTransitionBlocked(currentStep, nextStep)
    ) {
      if (nextIndex >= 0) {
        this.options.onBlocked()
      }
      return
    }

    this.setTransitionState(true)
    const generation = this.generation + 1
    this.generation = generation
    const controller = this.replacePreparationController()
    const preparation = await this.prepareStep(nextIndex, controller.signal, generation)
    const prepared = preparation === 'ready'
    const preparationRejected = preparation === 'blocked'
      && !controller.signal.aborted
      && generation === this.generation
      && !this.disposed
    if (!prepared || controller.signal.aborted || generation !== this.generation || this.disposed) {
      if (generation === this.generation) {
        if (preparationRejected) {
          this.options.onBlocked()
        }
        this.releaseTransition()
      }
      return
    }
    if (
      this.options.isBlocked()
      || this.options.isTransitionBlocked(currentStep, nextStep)
    ) {
      this.options.onBlocked()
      this.releaseTransition()
      return
    }
    try {
      this.driver?.moveTo(nextIndex)
    } catch (error) {
      try {
        this.options.onError(error)
      } finally {
        this.stop()
      }
    }
  }

  private async prepareStep(
    index: number,
    signal: AbortSignal,
    generation: number,
  ): Promise<ProductTourPreparationOutcome> {
    const step = this.content.steps[index]
    if (!step) {
      return 'blocked'
    }
    try {
      const result = await this.options.prepareStep(step, signal)
      if (signal.aborted || generation !== this.generation) {
        return 'cancelled'
      }
      return result === false ? 'blocked' : 'ready'
    } catch (error) {
      if (!signal.aborted && generation === this.generation) {
        this.options.onError(error)
        return 'failed'
      }
      return 'cancelled'
    }
  }

  private replacePreparationController() {
    this.preparationController?.abort()
    const controller = new AbortController()
    this.preparationController = controller
    return controller
  }

  private finish(reason: ProductTourCompletionReason) {
    if (!this.driver && !this.starting) {
      if (this.cleanupDriver) {
        this.stop()
      }
      return
    }
    let persisted = false
    try {
      try {
        persisted = this.options.completionStore.writeCompletedVersion(PRODUCT_TOUR_VERSION)
      } catch (error) {
        this.options.onError(error)
      }
      this.options.onCompleted(reason, persisted)
    } finally {
      this.stop()
    }
  }

  private setActive(active: boolean) {
    if (this.active === active) {
      return
    }
    this.active = active
    this.options.onActiveChange(active)
  }

  private handleDriverDestroyed() {
    this.generation += 1
    const destroyedGeneration = this.generation
    const focusTarget = this.initialFocus
    const shouldRestoreFocus = this.focusRestorationArmed
    this.initialFocus = null
    this.focusRestorationArmed = false
    this.preparationController?.abort()
    this.preparationController = null
    this.driver = null
    this.cleanupDriver = null
    this.clearPopoverDecoration()
    this.activePopover = null
    this.activePopoverDisabledState = null
    this.starting = false
    this.transitionLocked = false
    this.setActive(false)
    window.removeEventListener('keydown', this.handleKeyDown)
    delete document.body.dataset.termousProductTour
    this.applyPendingContent()
    if (shouldRestoreFocus) {
      queueMicrotask(() => {
        if (
          destroyedGeneration === this.generation
          && !this.driver
          && !this.cleanupDriver
          && !this.starting
        ) {
          restoreFocusTarget(focusTarget)
        }
      })
    }
  }

  private applyPendingContent() {
    if (!this.pendingContent) {
      return
    }
    this.content = this.pendingContent
    this.pendingContent = null
  }

  private renderPopover(popover: PopoverDOM, index: number | undefined) {
    this.clearPopoverDecoration()
    this.activePopover = popover
    this.activePopoverDisabledState = {
      previous: popover.previousButton.disabled,
      next: popover.nextButton.disabled,
    }
    popover.wrapper.dataset.productTourStep = this.content.steps[index ?? 0]?.id ?? ''
    popover.closeButton.setAttribute('aria-label', this.content.labels.close)
    popover.previousButton.setAttribute('aria-label', this.content.labels.previous)
    popover.nextButton.setAttribute(
      'aria-label',
      index === this.content.steps.length - 1
        ? this.content.labels.done
        : this.content.labels.next,
    )

    const meta = document.createElement('span')
    meta.className = this.options.styles.popoverMeta
    popover.footer.insertBefore(meta, popover.footerButtons)
    meta.appendChild(popover.progress)

    const skipButton = document.createElement('button')
    skipButton.type = 'button'
    skipButton.className = this.options.styles.skipButton
    skipButton.textContent = this.content.labels.skip
    skipButton.setAttribute('aria-label', this.content.labels.skip)
    skipButton.addEventListener('click', () => this.finish('skipped'), { once: true })
    meta.appendChild(skipButton)
    const step = this.content.steps[index ?? 0]
    if (step && this.options.decoratePopover) {
      try {
        this.popoverDecorationCleanup = this.options.decoratePopover({
          title: popover.title,
          closeButton: popover.closeButton,
        }, step) ?? null
      } catch (error) {
        this.options.onError(error)
      }
    }
    this.setTransitionState(this.transitionLocked)
    this.redirectInitialCloseFocus(popover)
  }

  private redirectInitialCloseFocus(popover: PopoverDOM) {
    popover.wrapper.tabIndex = -1
    // Driver.js 会在渲染后优先聚焦关闭按钮，转场期间先让对话框承接焦点。
    popover.closeButton.addEventListener('focus', () => {
      if (
        this.activePopover === popover
        && this.transitionLocked
        && popover.wrapper.isConnected
      ) {
        popover.wrapper.focus({ preventScroll: true })
      }
    }, { once: true })
  }

  private releaseTransition = (expectedIndex?: number) => {
    if (expectedIndex !== undefined && this.driver?.getActiveIndex() !== expectedIndex) {
      return
    }
    this.setTransitionState(false)
    this.focusPrimaryAction()
  }

  private focusPrimaryAction() {
    const popover = this.activePopover
    if (!popover?.wrapper.isConnected || popover.nextButton.disabled) {
      return
    }
    const activeElement = document.activeElement
    const tourOwnsFocus = activeElement === null
      || activeElement === document.body
      || activeElement === popover.closeButton
      || (activeElement instanceof Node && popover.wrapper.contains(activeElement))
    if (tourOwnsFocus) {
      popover.nextButton.focus({ preventScroll: true })
    }
  }

  private clearPopoverDecoration() {
    const cleanup = this.popoverDecorationCleanup
    this.popoverDecorationCleanup = null
    if (!cleanup) {
      return
    }
    try {
      cleanup()
    } catch (error) {
      this.options.onError(error)
    }
  }

  private setTransitionState(locked: boolean) {
    this.transitionLocked = locked
    if (!this.activePopover) {
      return
    }
    this.activePopover.wrapper.setAttribute('aria-busy', String(locked))
    this.activePopover.previousButton.disabled = locked
      || Boolean(this.activePopoverDisabledState?.previous)
    this.activePopover.nextButton.disabled = locked
      || Boolean(this.activePopoverDisabledState?.next)
    const skipButton = this.activePopover.wrapper.querySelector<HTMLButtonElement>(
      `.${this.options.styles.skipButton}`,
    )
    if (skipButton) {
      skipButton.disabled = locked
    }
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const dropdownOwnsFocus = hasVisiblePortal(dropdownPortalSelector, event.target)
    const higherPriorityPortalOpen = hasHigherPriorityPortal(event.target)
    if (event.key === 'Tab' || event.keyCode === 9) {
      // Dropdown 的监听器晚于 Driver.js 注册，需要让它最终接管菜单焦点。
      if (!dropdownOwnsFocus) {
        event.stopImmediatePropagation()
      }
      if (
        higherPriorityPortalOpen
        || event.defaultPrevented
        || event.repeat
        || event.isComposing
      ) {
        return
      }
      this.moveFocusWithinTour(event)
      return
    }
    if (event.defaultPrevented || event.repeat || event.isComposing) {
      return
    }
    if (higherPriorityPortalOpen) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.finish('closed')
      return
    }
    if (
      isEditableTarget(event.target)
      || usesCompositeKeyboardNavigation(event.target)
    ) {
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      void this.moveBy(-1)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      void this.moveBy(1)
      return
    }
    if (event.key === 'Enter' && !usesNativeEnterAction(event.target)) {
      event.preventDefault()
      void this.moveBy(1)
    }
  }

  private moveFocusWithinTour(event: KeyboardEvent) {
    const roots = [
      this.activePopover?.wrapper,
      ...document.querySelectorAll<HTMLElement>('.driver-active-element'),
    ].filter((element): element is HTMLElement => Boolean(element))
    const focusableElements = collectFocusableElements(roots)
    if (focusableElements.length === 0) {
      return
    }
    event.preventDefault()
    const activeIndex = focusableElements.indexOf(document.activeElement as HTMLElement)
    const nextIndex = event.shiftKey
      ? (activeIndex <= 0 ? focusableElements.length - 1 : activeIndex - 1)
      : (activeIndex < 0 || activeIndex === focusableElements.length - 1 ? 0 : activeIndex + 1)
    focusableElements[nextIndex]?.focus({ preventScroll: true })
  }
}

function findVisibleTourTarget(selector: string) {
  return Array.from(document.querySelectorAll<Element>(selector)).find(isVisibleElement)
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
  ))
}

function usesNativeEnterAction(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    [
      'button',
      'a[href]',
      'summary',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="link"]',
      '[role="switch"]',
    ].join(', '),
  ))
}

const compositeKeyboardControlSelector = [
  '[role="combobox"]',
  '[role="grid"]',
  '[role="gridcell"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="scrollbar"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="tree"]',
  '[role="treegrid"]',
  '[role="treeitem"]',
].join(', ')

function usesCompositeKeyboardNavigation(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest(compositeKeyboardControlSelector))
}

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function collectFocusableElements(roots: HTMLElement[]) {
  const elements = new Set<HTMLElement>()
  roots.forEach((root) => {
    if (root.matches(focusableSelector)) {
      elements.add(root)
    }
    root.querySelectorAll<HTMLElement>(focusableSelector).forEach((element) => elements.add(element))
  })
  return Array.from(elements).filter((element) => (
    element.tabIndex >= 0
    && element.getAttribute('aria-disabled') !== 'true'
    && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && isVisibleElement(element)
    && window.getComputedStyle(element).pointerEvents !== 'none'
  ))
}

function isVisibleElement(element: Element) {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && rect.width > 0
    && rect.height > 0
}

const dropdownPortalSelector = '.ant-dropdown:not(.ant-dropdown-hidden)'

const blockingPortalSelector = [
  '.ant-modal-root',
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '.ant-popover:not(.ant-popover-hidden)',
].join(', ')

const higherPriorityPortalSelector = [dropdownPortalSelector, blockingPortalSelector].join(', ')

function hasHigherPriorityPortal(target: EventTarget | null) {
  return hasVisiblePortal(higherPriorityPortalSelector, target)
}

function hasVisiblePortal(selector: string, target: EventTarget | null) {
  const targetPortal = target instanceof Element
    ? target.closest<HTMLElement>(selector)
    : null
  if (targetPortal) {
    return true
  }
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .some((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && (rect.width > 0 || rect.height > 0)
    })
}

function resolveFocusReturnTarget() {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && activeElement !== document.body) {
    return activeElement
  }
  return resolveProductTourTrigger()
}

function restoreFocusTarget(target: HTMLElement | null) {
  const candidate = target?.isConnected && isVisibleElement(target)
    ? target
    : resolveProductTourTrigger()
  candidate?.focus({ preventScroll: true })
}

function resolveProductTourTrigger() {
  const anchor = findVisibleTourTarget('[data-tour="product-tour-trigger"]')
  if (!(anchor instanceof HTMLElement)) {
    return null
  }
  if (anchor.matches(focusableSelector)) {
    return anchor
  }
  return Array.from(anchor.querySelectorAll<HTMLElement>(focusableSelector))
    .find(isVisibleElement) ?? null
}
