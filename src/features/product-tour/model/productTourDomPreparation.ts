import type { ProductTourStep } from './productTourSteps.ts'

const PREPARATION_TIMEOUT_MS = 1200
const settingsTabActions = {
  settingsTerminal: '[data-tour="settings-terminal-tab"]',
  settingsMount: '[data-tour="settings-mount-tab"]',
  settingsMcp: '[data-tour="settings-mcp-tab"]',
  settingsAgent: '[data-tour="settings-agent-tab"]',
  settingsData: '[data-tour="settings-data-tab"]',
} as const

export async function prepareProductTourDom(
  step: ProductTourStep,
  signal: AbortSignal,
) {
  if (!step.preparation) {
    return
  }

  switch (step.preparation) {
    case 'vaultCatalog':
      await ensureTarget(
        step.element,
        '[data-active-view="editor"] [data-tour="credential-back"]',
        signal,
      )
      return
    case 'credentialEditor':
      await ensureTarget(
        step.element,
        '[data-active-view="catalog"] [data-tour="vault-add"]',
        signal,
      )
      return
    case 'hostCatalog':
      await ensureTarget(
        step.element,
        '[data-active-view="editor"] [data-tour="host-back"]',
        signal,
      )
      return
    case 'hostEditor':
    case 'hostConnections':
      await prepareHostEditor(step, signal)
      return
    case 'settingsTerminal':
    case 'settingsMount':
    case 'settingsMcp':
    case 'settingsAgent':
    case 'settingsData':
      // 通过原页签动作展示设置，保留已经挂载的表单、编辑稿和导入会话。
      await ensureTarget(step.element, settingsTabActions[step.preparation], signal)
      if (!signal.aborted && step.element) {
        const content = document.querySelector<HTMLElement>(step.element)
        if (content) {
          content.scrollTop = 0
          // 子元素锚点可能被页签内的滚动容器裁切，不能只依赖 Driver 对浏览器视口的判断。
          content.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
        }
      }
      return
    default:
      assertNeverPreparation(step.preparation)
  }
}

async function prepareHostEditor(step: ProductTourStep, signal: AbortSignal) {
  const hostEditor = '[data-active-view="editor"] [data-tour="host-editor"]'
  const hostCatalogAdd = '[data-active-view="catalog"] [data-tour="hosts-add"]'
  if (!document.querySelector(hostEditor)) {
    await ensureTarget(
      hostCatalogAdd,
      '[data-active-view="editor"] [data-tour="host-back"]',
      signal,
    )
    if (signal.aborted) {
      return
    }
    await ensureTarget(hostEditor, hostCatalogAdd, signal)
  }
  if (signal.aborted) {
    return
  }

  if (step.preparation === 'hostEditor') {
    await ensureTarget(
      '[data-active-view="editor"] [data-tour="host-asset-form"]',
      '[data-active-view="editor"] [data-tour="host-asset-tab"]',
      signal,
    )
    return
  }

  await ensureTarget(
    step.element,
    '[data-active-view="editor"] [data-tour="host-connections-tab"]',
    signal,
  )
}

function assertNeverPreparation(preparation: never): never {
  throw new Error(`未知的使用向导页面准备类型: ${String(preparation)}`)
}

async function ensureTarget(
  targetSelector: string | undefined,
  actionSelector: string,
  signal: AbortSignal,
) {
  if (!targetSelector || document.querySelector(targetSelector)) {
    return
  }
  const ready = await waitForTargetOrAction(targetSelector, actionSelector, signal)
  if (!ready || ready.kind === 'target' || signal.aborted) {
    return
  }
  ready.element.click()
  await waitForElement(targetSelector, signal)
}

function waitForTargetOrAction(
  targetSelector: string,
  actionSelector: string,
  signal: AbortSignal,
) {
  return waitForMatch(() => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (target) {
      return { kind: 'target' as const, element: target }
    }
    const action = document.querySelector<HTMLElement>(actionSelector)
    return action ? { kind: 'action' as const, element: action } : null
  }, signal)
}

function waitForElement(selector: string, signal: AbortSignal): Promise<HTMLElement | null> {
  return waitForMatch(() => document.querySelector<HTMLElement>(selector), signal)
}

function waitForMatch<Result>(
  find: () => Result | null,
  signal: AbortSignal,
): Promise<Result | null> {
  const current = find()
  if (current || signal.aborted) return Promise.resolve(current)

  return new Promise((resolve) => {
    let settled = false
    const observer = new MutationObserver(() => {
      const result = find()
      if (result) {
        finish(result)
      }
    })
    const timeout = window.setTimeout(() => finish(null), PREPARATION_TIMEOUT_MS)
    const handleAbort = () => finish(null)
    const finish = (result: Result | null) => {
      if (settled) {
        return
      }
      settled = true
      observer.disconnect()
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', handleAbort)
      resolve(result)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-active-view', 'aria-hidden'],
    })
  })
}
