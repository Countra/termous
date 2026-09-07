import { act, render } from '@testing-library/react'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { describe, expect, it } from 'vitest'
import type { ProductTourStep, ProductTourStepId } from '../model/productTourSteps.ts'
import {
  ProductTourPopoverChrome,
  type ProductTourPopoverDecoration,
} from './ProductTourPopoverChrome.tsx'
import { decorateProductTourPopover } from './productTourPopoverDecoration.ts'

const stepIconCases = [
  ['welcome', 'lucide-compass'],
  ['vaultNav', 'lucide-key-round'],
  ['vaultActions', 'lucide-wand-sparkles'],
  ['credentialEditor', 'lucide-shield-check'],
  ['hostsNav', 'lucide-server'],
  ['hostEditor', 'lucide-server-cog'],
  ['hostConnections', 'lucide-network'],
  ['topbarConnect', 'lucide-plug-zap'],
  ['workbench', 'lucide-square-terminal'],
  ['finish', 'lucide-circle-check'],
] as const satisfies ReadonlyArray<readonly [ProductTourStepId, string]>

describe('使用向导浮层装饰器', () => {
  it.each(stepIconCases)('%s 步骤渲染对应的 Lucide 图标和步骤标识', (id, iconClass) => {
    const target = createPopoverTarget()
    const portal = renderChrome()
    let cleanup: () => void = () => undefined
    act(() => {
      cleanup = decorateProductTourPopover(target, createStep(id), portal.setDecoration)
    })
    const stepIcon = target.title.querySelector<HTMLElement>(
      `[data-product-tour-step-icon="${id}"]`,
    )

    expect(stepIcon).not.toBeNull()
    expect(stepIcon?.querySelector('svg')).toHaveClass('lucide', iconClass)

    act(() => cleanup())
    portal.view.unmount()
  })

  it('用 X 图标替换关闭内容并在幂等清理后完整恢复 DOM 状态', () => {
    const target = createPopoverTarget()
    const portal = renderChrome()
    const titleText = document.createTextNode('连接到 ')
    const titleStrong = document.createElement('strong')
    titleStrong.textContent = 'Termous'
    target.title.append(titleText, titleStrong)
    target.closeButton.innerHTML = '&times;'
    target.closeButton.style.display = 'block'
    target.closeButton.setAttribute('aria-label', '关闭向导')
    const originalTitleNodes = Array.from(target.title.childNodes)
    const originalCloseContent = target.closeButton.innerHTML

    let cleanup: () => void = () => undefined
    act(() => {
      cleanup = decorateProductTourPopover(target, createStep('welcome'), portal.setDecoration)
    })

    expect(target.closeButton.querySelector('svg')).toHaveClass('lucide', 'lucide-x')
    expect(target.closeButton).not.toHaveTextContent('×')
    expect(target.closeButton).toHaveAttribute('aria-label', '关闭向导')
    expect(target.closeButton).toHaveAttribute('data-product-tour-close-icon', 'true')
    expect(target.closeButton.style.display).toBe('inline-flex')

    act(() => {
      cleanup()
      cleanup()
    })

    expect(Array.from(target.title.childNodes)).toEqual(originalTitleNodes)
    expect(target.title).not.toContainHTML('svg')
    expect(target.closeButton.innerHTML).toBe(originalCloseContent)
    expect(target.closeButton.style.display).toBe('block')
    expect(target.closeButton).toHaveAttribute('aria-label', '关闭向导')
    expect(target.closeButton).not.toHaveAttribute('data-product-tour-close-icon')
    portal.view.unmount()
  })
})

function renderChrome() {
  let setDecoration!: Dispatch<SetStateAction<ProductTourPopoverDecoration | null>>

  function Harness() {
    const [decoration, setDecorationState] = useState<ProductTourPopoverDecoration | null>(null)
    setDecoration = setDecorationState
    return <ProductTourPopoverChrome decoration={decoration} />
  }

  return {
    view: render(<Harness />),
    setDecoration,
  }
}

function createPopoverTarget() {
  return {
    title: document.createElement('div'),
    closeButton: document.createElement('button'),
  }
}

function createStep(id: ProductTourStepId): ProductTourStep {
  return {
    id,
    title: id,
    description: id,
  }
}
