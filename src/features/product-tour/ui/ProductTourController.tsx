import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProductTourDriverFactory } from '../model/productTourDriverAdapter.ts'
import { prepareProductTourDom } from '../model/productTourDomPreparation.ts'
import { ProductTourEngine } from '../model/ProductTourEngine.ts'
import {
  buildProductTourLabels,
  buildProductTourSteps,
  type ProductTourStep,
} from '../model/productTourSteps.ts'
import {
  browserProductTourCompletionStore,
  hasCompletedCurrentProductTour,
  type ProductTourCompletionStore,
} from '../model/productTourStorage.ts'
import {
  ProductTourPopoverChrome,
  type ProductTourPopoverDecoration,
} from './ProductTourPopoverChrome.tsx'
import { decorateProductTourPopover } from './productTourPopoverDecoration.ts'
import styles from './ProductTour.module.scss'

export interface ProductTourControllerProps {
  ready: boolean
  autoStartEligible: boolean
  blocked: boolean
  isTransitionBlocked?: (currentStep: ProductTourStep, nextStep: ProductTourStep) => boolean
  manualRequestKey: number
  onPrepareStep: (
    step: ProductTourStep,
    signal: AbortSignal,
  ) => boolean | void | Promise<boolean | void>
  onBlocked: () => void
  onError: (error: unknown) => void
  onActiveChange?: (active: boolean) => void
  completionStore?: ProductTourCompletionStore
  driverFactory?: ProductTourDriverFactory
}

export function ProductTourController({
  ready,
  autoStartEligible,
  blocked,
  isTransitionBlocked = () => false,
  manualRequestKey,
  onPrepareStep,
  onBlocked,
  onError,
  onActiveChange,
  completionStore = browserProductTourCompletionStore,
  driverFactory,
}: ProductTourControllerProps) {
  const { t } = useTranslation()
  const steps = useMemo(() => buildProductTourSteps(t), [t])
  const labels = useMemo(() => buildProductTourLabels(t), [t])
  const [popoverDecoration, setPopoverDecoration] = useState<ProductTourPopoverDecoration | null>(null)
  const contentRef = useRef({ steps, labels })
  const latestRef = useRef({
    ready,
    blocked,
    isTransitionBlocked,
    onPrepareStep,
    onBlocked,
    onError,
    onActiveChange,
  })
  const engineRef = useRef<ProductTourEngine | null>(null)
  const autoHandledRef = useRef(false)
  const lastManualRequestRef = useRef(0)
  contentRef.current = { steps, labels }
  latestRef.current = {
    ready,
    blocked,
    isTransitionBlocked,
    onPrepareStep,
    onBlocked,
    onError,
    onActiveChange,
  }

  useEffect(() => {
    const initialContent = contentRef.current
    const engine = new ProductTourEngine({
      steps: initialContent.steps,
      labels: initialContent.labels,
      styles: {
        popover: styles.popover,
        popoverMeta: styles['popover-meta'],
        skipButton: styles['skip-button'],
      },
      completionStore,
      driverFactory,
      isBlocked: () => !latestRef.current.ready || latestRef.current.blocked,
      isTransitionBlocked: (currentStep, nextStep) => (
        latestRef.current.isTransitionBlocked(currentStep, nextStep)
      ),
      onBlocked: () => latestRef.current.onBlocked(),
      onError: (error) => latestRef.current.onError(error),
      onActiveChange: (active) => latestRef.current.onActiveChange?.(active),
      decoratePopover: (target, step) => (
        decorateProductTourPopover(target, step, setPopoverDecoration)
      ),
      onCompleted: () => {
        autoHandledRef.current = true
      },
      prepareStep: async (step, signal) => {
        const allowed = await latestRef.current.onPrepareStep(step, signal)
        if (allowed === false || signal.aborted) {
          return false
        }
        await prepareProductTourDom(step, signal)
        return !signal.aborted
      },
    })
    engineRef.current = engine
    return () => {
      if (engineRef.current === engine) {
        engineRef.current = null
      }
      engine.dispose()
    }
  }, [completionStore, driverFactory])

  useEffect(() => {
    engineRef.current?.updateContent(steps, labels)
  }, [labels, steps])

  useEffect(() => {
    if (!ready) {
      engineRef.current?.stop()
      return
    }
    if (autoHandledRef.current) {
      return
    }
    if (!autoStartEligible) {
      autoHandledRef.current = true
      return
    }
    if (blocked) {
      return
    }
    if (hasCompletedCurrentProductTour(completionStore)) {
      autoHandledRef.current = true
      return
    }

    let cancelled = false
    const attemptController = new AbortController()
    const timer = window.setTimeout(() => {
      const engine = engineRef.current
      if (!engine || cancelled) {
        return
      }
      void engine.start(attemptController.signal).then((started) => {
        if (started && !cancelled) {
          autoHandledRef.current = true
        }
      })
    }, 0)
    return () => {
      cancelled = true
      attemptController.abort()
      window.clearTimeout(timer)
    }
  }, [autoStartEligible, blocked, completionStore, ready])

  useEffect(() => {
    if (manualRequestKey <= lastManualRequestRef.current) {
      return
    }
    const requestKey = manualRequestKey
    const attemptController = new AbortController()
    const timer = window.setTimeout(() => {
      const engine = engineRef.current
      if (!engine) {
        return
      }
      void engine.start(attemptController.signal).finally(() => {
        if (!attemptController.signal.aborted) {
          lastManualRequestRef.current = Math.max(lastManualRequestRef.current, requestKey)
        }
      })
    }, 0)
    return () => {
      attemptController.abort()
      window.clearTimeout(timer)
    }
  }, [manualRequestKey])

  return <ProductTourPopoverChrome decoration={popoverDecoration} />
}
