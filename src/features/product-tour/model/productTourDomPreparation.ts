import type { ProductTourStep } from './productTourSteps.ts'
import { findProductTourTarget } from './productTourTargets.ts'

const PREPARATION_TIMEOUT_MS = 1200
const settingsTabActions = {
  settingsTerminal: '[data-tour="settings-terminal-tab"]',
  settingsMount: '[data-tour="settings-mount-tab"]',
  settingsMcp: '[data-tour="settings-mcp-tab"]',
  settingsAgent: '[data-tour="settings-agent-tab"]',
  settingsData: '[data-tour="settings-data-tab"]',
  settingsModels: '[data-tour="settings-models-tab"]',
  settingsConnection: '[data-tour="settings-connection-tab"]',
  settingsDesktop: '[data-tour="settings-remote-desktop-tab"]',
} as const

const extensionTabs = { extensionsMcp: 'mcp', extensionsSkills: 'skill', extensionsSearch: 'search' } as const

export async function prepareProductTourDom(
  step: ProductTourStep,
  signal: AbortSignal,
) {
  if (step.workflowView && !signal.aborted) {
    await waitForElement(`[data-tour="automation-view"][data-active-view="${step.workflowView}"]`, signal)
  }
  if (!step.preparation || signal.aborted) {
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
    case 'settingsModels':
    case 'settingsConnection':
    case 'settingsDesktop':
      // 通过原页签动作展示设置，保留已经挂载的表单、编辑稿和导入会话。
      await ensureTarget(settingsPanel(step.preparation), settingsTabActions[step.preparation], signal)
      scrollTarget(step, signal)
      return
    case 'extensionsMcp':
    case 'extensionsSkills':
    case 'extensionsSearch': {
      const outer = '[role="tabpanel"][aria-hidden="false"] [data-tour="settings-extensions"]'
      await ensureTarget(outer, '[data-tour="settings-extensions-tab"]', signal)
      if (signal.aborted || !findProductTourTarget(outer)) return
      const tab = extensionTabs[step.preparation]
      await ensureTarget(`${outer} [data-tour="extensions-${tab}"]`, `${outer} [data-tour="extensions-${tab}-tab"]`, signal)
      scrollTarget(step, signal)
      return
    }
    default:
      assertNeverPreparation(step.preparation)
  }
}

function settingsPanel(preparation: keyof typeof settingsTabActions) {
  const name = { settingsTerminal: 'terminal', settingsMount: 'mount', settingsMcp: 'mcp', settingsAgent: 'agent', settingsData: 'data', settingsModels: 'models', settingsConnection: 'connection', settingsDesktop: 'remote-desktop' }[preparation]
  return `[role="tabpanel"][aria-hidden="false"] [data-tour="settings-${name}"]`
}

function scrollTarget(step: ProductTourStep, signal: AbortSignal) {
  if (signal.aborted) return
  const content = step.element && findProductTourTarget(step.element)
    || step.fallbackElement && findProductTourTarget(step.fallbackElement)
  if (!content) return
  content.scrollTop = 0
  // 页签内的滚动容器可能裁切目标，不能只依赖 Driver 对浏览器视口的判断。
  content.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
}

async function prepareHostEditor(step: ProductTourStep, signal: AbortSignal) {
  const hostEditor = '[data-active-view="editor"] [data-tour="host-editor"]'
  const hostCatalogAdd = '[data-active-view="catalog"] [data-tour="hosts-add"]'
  if (!findProductTourTarget(hostEditor)) {
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
  if (signal.aborted || !targetSelector || findProductTourTarget(targetSelector)) {
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
    const target = findProductTourTarget(targetSelector)
    if (target) {
      return { kind: 'target' as const, element: target }
    }
    const action = findProductTourTarget(actionSelector)
    return action ? { kind: 'action' as const, element: action } : null
  }, signal)
}

function waitForElement(selector: string, signal: AbortSignal): Promise<HTMLElement | null> {
  return waitForMatch(() => findProductTourTarget(selector) ?? null, signal)
}

function waitForMatch<Result>(
  find: () => Result | null,
  signal: AbortSignal,
): Promise<Result | null> {
  if (signal.aborted) return Promise.resolve(null)
  const current = find()
  if (current) return Promise.resolve(current)

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
      attributeFilter: ['data-active-view', 'aria-hidden', 'hidden', 'inert', 'aria-disabled', 'disabled', 'style', 'class'],
    })
  })
}
