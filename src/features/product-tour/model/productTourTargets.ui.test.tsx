import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import { ProductTourEngine } from './ProductTourEngine.ts'
import { resolveProductTourTarget } from './productTourTargets.ts'
import type { ProductTourStep } from './productTourTypes.ts'

const step: ProductTourStep = {
  id: 'agentExtensions', title: '会话扩展', description: '选择当前会话的扩展。',
  element: '[data-tour="detail"]', fallbackElement: '[data-tour="workspace"]', fallbackDescription: '进入可用会话后再选择扩展。',
}
let engine: ProductTourEngine | undefined

function createEngine(steps: ProductTourStep[]) {
  return new ProductTourEngine({
    steps,
    labels: { next: 'next', previous: 'previous', done: 'done', close: 'close', skip: 'skip', progress: '{{current}} / {{total}}' },
    styles: { popover: 'tour-popover', popoverMeta: 'tour-meta', skipButton: 'tour-skip' },
    completionStore: { readCompletedVersion: () => null, writeCompletedVersion: () => true },
    prepareStep: () => true, isBlocked: () => false, isTransitionBlocked: () => false,
    onBlocked: vi.fn(), onError: vi.fn(), onActiveChange: vi.fn(), onCompleted: vi.fn(),
  })
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 40))
  document.body.innerHTML = '<section data-tour="workspace"><button data-tour="detail"></button></section>'
})
afterEach(() => { engine?.dispose(); engine = undefined; document.body.replaceChildren(); vi.restoreAllMocks() })

it.each(['hidden', 'inert', 'aria-hidden', 'disabled', 'aria-disabled'] as const)('%s 目标退回父级并使用条件说明', attribute => {
  const detail = document.querySelector('button')!
  detail.setAttribute(attribute, attribute.startsWith('aria') ? 'true' : '')
  expect(resolveProductTourTarget(step)).toEqual({ element: document.querySelector('section'), description: step.fallbackDescription })
  detail.removeAttribute(attribute)
  expect(resolveProductTourTarget(step)).toEqual({ element: detail, description: step.description })
})

it('排除缓存页签与不可见父级，所有目标不可用时居中说明', () => {
  const workspace = document.querySelector('section')!
  workspace.setAttribute('aria-hidden', 'true')
  expect(resolveProductTourTarget(step)).toEqual({ element: undefined, description: step.fallbackDescription })
  const active = workspace.cloneNode(true) as HTMLElement
  active.removeAttribute('aria-hidden')
  document.body.append(active)
  expect(resolveProductTourTarget(step).element).toBe(active.querySelector('button'))
})

it('允许定位包含禁用子控件的说明区域，不将其误认为可点击按钮', () => {
  const detail = document.querySelector('button')!
  detail.disabled = true
  expect(resolveProductTourTarget({ ...step, element: '[data-tour="workspace"]' }).description).toBe(step.description)
})

it.each(['关闭', '卸载'] as const)('真实 Driver %s 后恢复功能按钮原有的 ARIA 属性', async ending => {
  const target = document.querySelector('button')!
  target.setAttribute('aria-haspopup', 'menu')
  target.setAttribute('aria-expanded', 'false')
  target.setAttribute('aria-controls', 'original-menu')
  engine = createEngine([step, { ...step, id: 'agentWorkspace', element: '[data-tour="workspace"]' }])
  await engine.start()
  await waitFor(() => expect(document.querySelector('[aria-label="next"]')).not.toBeDisabled())
  if (ending === '关闭') {
    fireEvent.click(document.querySelector('[aria-label="close"]')!)
  } else {
    engine.dispose()
  }
  expect(target).toHaveAttribute('aria-haspopup', 'menu')
  expect(target).toHaveAttribute('aria-expanded', 'false')
  expect(target).toHaveAttribute('aria-controls', 'original-menu')
  expect(document.querySelector('.driver-active-element')).toBeNull()
})

it('切换步骤及重复高亮同一目标后仍保留原属性，不留下向导临时属性', async () => {
  const target = document.querySelector('button')!
  target.setAttribute('aria-expanded', 'false')
  engine = createEngine([step, { ...step, id: 'agentWorkspace' }, { ...step, id: 'agent', element: '[data-tour="workspace"]' }])
  await engine.start()
  await waitFor(() => expect(document.querySelector('[aria-label="next"]')).not.toBeDisabled())
  fireEvent.click(document.querySelector('[aria-label="next"]')!)
  await waitFor(() => expect(document.querySelector('[data-product-tour-step="agentWorkspace"]')).toHaveAttribute('aria-busy', 'false'))
  fireEvent.click(document.querySelector('[aria-label="next"]')!)
  await waitFor(() => expect(document.querySelector('[data-product-tour-step="agent"]')).toHaveAttribute('aria-busy', 'false'))
  expect(target).toHaveAttribute('aria-expanded', 'false')
  expect(target).not.toHaveAttribute('aria-haspopup')
  expect(target).not.toHaveAttribute('aria-controls')
  engine.dispose()
  expect(document.querySelector('section')).not.toHaveAttribute('aria-haspopup')
})
