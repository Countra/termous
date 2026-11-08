import type { ProductTourStep } from './productTourTypes.ts'

export function findProductTourTarget(selector: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => {
    if (element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]') || element.matches(':disabled')) return false
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  })
}

export function resolveProductTourTarget(step: ProductTourStep) {
  const primary = step.element ? findProductTourTarget(step.element) : undefined
  return {
    element: primary ?? (step.fallbackElement ? findProductTourTarget(step.fallbackElement) : undefined),
    description: !step.element || primary ? step.description : step.fallbackDescription ?? step.description,
  }
}

const targetAttributes = ['aria-haspopup', 'aria-expanded', 'aria-controls'] as const

// Driver 会覆盖并删除高亮目标的 ARIA 属性，离开目标后需恢复业务控件原值。
export class ProductTourTargetAttributes {
  private readonly snapshots = new Map<Element, (string | null)[]>()

  capture(element: Element | undefined) {
    if (!element || this.snapshots.has(element)) return
    this.snapshots.set(element, targetAttributes.map(name => element.getAttribute(name)))
  }

  restore(except?: Element) {
    for (const [element, values] of this.snapshots) {
      if (element === except) continue
      targetAttributes.forEach((name, index) => {
        const value = values[index]
        if (value === null) element.removeAttribute(name)
        else element.setAttribute(name, value)
      })
      this.snapshots.delete(element)
    }
  }
}
