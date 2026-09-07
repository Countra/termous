import type { Dispatch, SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import type { PopoverDOM } from 'driver.js'
import type { ProductTourStep } from '../model/productTourSteps.ts'
import type { ProductTourPopoverDecoration } from './ProductTourPopoverChrome.tsx'
import styles from './ProductTour.module.scss'

export function decorateProductTourPopover(
  target: Pick<PopoverDOM, 'title' | 'closeButton'>,
  step: ProductTourStep,
  setDecoration: Dispatch<SetStateAction<ProductTourPopoverDecoration | null>>,
) {
  const titleIcon = document.createElement('span')
  const titleText = document.createElement('span')
  const closeIcon = document.createElement('span')
  const previousCloseNodes = Array.from(target.closeButton.childNodes)
  const previousCloseDisplay = target.closeButton.style.display
  titleIcon.className = styles['step-icon']
  titleIcon.dataset.productTourStepIcon = step.id
  titleIcon.setAttribute('aria-hidden', 'true')
  titleText.className = styles['step-title']
  closeIcon.className = styles['close-icon']
  closeIcon.setAttribute('aria-hidden', 'true')
  while (target.title.firstChild) {
    titleText.appendChild(target.title.firstChild)
  }
  target.title.append(titleIcon, titleText)
  target.closeButton.replaceChildren(closeIcon)
  target.closeButton.dataset.productTourCloseIcon = 'true'
  target.closeButton.style.display = 'inline-flex'

  let released = false
  const decoration: ProductTourPopoverDecoration = {
    stepId: step.id,
    titleIcon,
    closeIcon,
    release: () => {
      if (released) {
        return
      }
      released = true
      titleIcon.remove()
      while (titleText.firstChild) {
        target.title.appendChild(titleText.firstChild)
      }
      titleText.remove()
      target.closeButton.replaceChildren(...previousCloseNodes)
      target.closeButton.style.display = previousCloseDisplay
      delete target.closeButton.dataset.productTourCloseIcon
    },
  }

  flushSync(() => setDecoration(decoration))
  return () => {
    setDecoration((current) => current === decoration ? null : current)
  }
}
