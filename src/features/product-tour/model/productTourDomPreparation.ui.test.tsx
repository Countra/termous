import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareProductTourDom } from './productTourDomPreparation.ts'
import { buildProductTourSteps } from './productTourSteps.ts'

const steps = buildProductTourSteps((key) => key)
afterEach(() => vi.restoreAllMocks())

describe('使用向导页面准备', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 100, 40))
  })

  it('通过现有新增动作打开空白凭据编辑器', async () => {
    const workspace = document.createElement('section')
    workspace.dataset.activeView = 'catalog'
    const add = document.createElement('button')
    add.dataset.tour = 'vault-add'
    const onCreate = vi.fn(() => {
      workspace.dataset.activeView = 'editor'
      const editor = document.createElement('section')
      editor.dataset.tour = 'credential-editor'
      workspace.appendChild(editor)
    })
    add.addEventListener('click', onCreate)
    workspace.appendChild(add)
    document.body.appendChild(workspace)

    await prepareProductTourDom(
      steps.find((step) => step.id === 'credentialEditor')!,
      new AbortController().signal,
    )

    expect(onCreate).toHaveBeenCalledOnce()
    expect(workspace.dataset.activeView).toBe('editor')
  })

  it('后退到凭据动作步骤时复用编辑器返回动作', async () => {
    const workspace = document.createElement('section')
    workspace.dataset.activeView = 'editor'
    const back = document.createElement('button')
    back.dataset.tour = 'credential-back'
    const onBack = vi.fn(() => {
      workspace.dataset.activeView = 'catalog'
      const actions = document.createElement('div')
      actions.dataset.tour = 'vault-actions'
      workspace.appendChild(actions)
    })
    back.addEventListener('click', onBack)
    workspace.appendChild(back)
    document.body.appendChild(workspace)

    await prepareProductTourDom(
      steps.find((step) => step.id === 'vaultActions')!,
      new AbortController().signal,
    )

    expect(onBack).toHaveBeenCalledOnce()
    expect(workspace.dataset.activeView).toBe('catalog')
  })

  it('主机连接步骤依次打开新建编辑器并切换连接页签', async () => {
    const workspace = document.createElement('section')
    workspace.dataset.activeView = 'catalog'
    const add = document.createElement('button')
    add.dataset.tour = 'hosts-add'
    const openEditor = vi.fn(() => {
      workspace.dataset.activeView = 'editor'
      const editor = document.createElement('section')
      editor.dataset.tour = 'host-editor'
      const asset = document.createElement('div')
      asset.dataset.tour = 'host-asset-form'
      const connectionsTab = document.createElement('button')
      connectionsTab.dataset.tour = 'host-connections-tab'
      connectionsTab.addEventListener('click', () => {
        asset.remove()
        const catalog = document.createElement('div')
        catalog.dataset.tour = 'host-connection-catalog'
        editor.appendChild(catalog)
      })
      editor.append(asset, connectionsTab)
      workspace.appendChild(editor)
    })
    add.addEventListener('click', openEditor)
    workspace.appendChild(add)
    document.body.appendChild(workspace)

    await prepareProductTourDom(
      steps.find((step) => step.id === 'hostConnections')!,
      new AbortController().signal,
    )

    expect(openEditor).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-tour="host-connection-catalog"]')).not.toBeNull()
  })

  it('主机保存转为编辑模式后继续使用当前编辑器进入连接页', async () => {
    const workspace = document.createElement('section')
    workspace.dataset.activeView = 'editor'
    const existingEditor = document.createElement('section')
    existingEditor.dataset.tour = 'host-editor'
    const back = document.createElement('button')
    back.dataset.tour = 'host-back'
    const connectionsTab = document.createElement('button')
    connectionsTab.dataset.tour = 'host-connections-tab'
    const add = document.createElement('button')
    add.dataset.tour = 'hosts-add'
    const onBack = vi.fn(() => {
      workspace.dataset.activeView = 'catalog'
    })
    const onCreate = vi.fn(() => {
      workspace.dataset.activeView = 'editor'
    })
    const openConnections = vi.fn(() => {
      const connections = document.createElement('div')
      connections.dataset.tour = 'host-connection-catalog'
      existingEditor.appendChild(connections)
    })
    back.addEventListener('click', onBack)
    add.addEventListener('click', onCreate)
    connectionsTab.addEventListener('click', openConnections)
    existingEditor.append(back, connectionsTab)
    workspace.append(existingEditor, add)
    document.body.appendChild(workspace)

    await prepareProductTourDom(
      steps.find((step) => step.id === 'hostConnections')!,
      new AbortController().signal,
    )

    expect(onBack).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
    expect(openConnections).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-tour="host-connection-catalog"]')).not.toBeNull()
  })

  it('目标先于动作出现时立即完成等待', async () => {
    const preparation = prepareProductTourDom(
      steps.find((step) => step.id === 'hostsNav')!,
      new AbortController().signal,
    )
    const workspace = document.createElement('section')
    workspace.dataset.activeView = 'catalog'
    const target = document.createElement('button')
    target.dataset.tour = 'hosts-add'
    workspace.appendChild(target)
    document.body.appendChild(workspace)

    await preparation

    expect(document.querySelector('[data-tour="hosts-add"]')).toBe(target)
  })

  it('取消等待会及时释放且不触发迟到动作', async () => {
    const controller = new AbortController()
    const preparation = prepareProductTourDom(
      steps.find((step) => step.id === 'credentialEditor')!,
      controller.signal,
    )
    controller.abort()

    await expect(preparation).resolves.toBeUndefined()
  })

  it.each([
    ['settingsTerminal', 'terminal'],
    ['settingsMount', 'mount'],
    ['settingsMcp', 'mcp'],
    ['settingsAgent', 'agent'],
    ['settingsData', 'data'],
  ] as const)('%s 激活已缓存的隐藏页签，保留草稿并回到内容顶部', async (stepId, tabKey) => {
    const panel = document.createElement('div')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-hidden', 'true')
    const content = document.createElement('div')
    content.dataset.tour = `settings-${tabKey}`
    content.scrollTop = 180
    const draft = document.createElement('input')
    draft.value = '未保存的设置'
    const save = document.createElement('button')
    const onSave = vi.fn()
    save.addEventListener('click', onSave)
    content.append(draft, save)
    panel.appendChild(content)
    const tab = document.createElement('button')
    tab.dataset.tour = `settings-${tabKey}-tab`
    const onSelect = vi.fn(() => {
      queueMicrotask(() => panel.setAttribute('aria-hidden', 'false'))
    })
    tab.addEventListener('click', onSelect)
    document.body.append(tab, panel)
    const step = steps.find((item) => item.id === stepId)!

    await prepareProductTourDom(step, new AbortController().signal)
    await prepareProductTourDom(step, new AbortController().signal)

    expect(onSelect).toHaveBeenCalledOnce()
    expect(document.querySelector(step.element!)).toBe(content)
    expect(content.scrollTop).toBe(0)
    expect(content.querySelector('input')).toBe(draft)
    expect(draft.value).toBe('未保存的设置')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('文件入口讲解不展开面板或触发目录访问', async () => {
    const onOpen = vi.fn()
    for (const step of steps.filter((item) => item.route === 'files' && item.id !== 'files')) {
      const entry = document.createElement('button')
      entry.dataset.tour = step.element!.match(/data-tour="([^"]+)"/)![1]
      entry.addEventListener('click', onOpen)
      document.body.appendChild(entry)
      await prepareProductTourDom(step, new AbortController().signal)
    }
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each([false, true])('Skills 入口禁用状态为 %s 时激活页签并滚入视野，不打开安装窗口', async (disabled) => {
    const panel = document.createElement('div')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-hidden', 'true')
    const entry = document.createElement('span')
    entry.dataset.tour = 'settings-skills-install'
    entry.scrollIntoView = vi.fn()
    const install = document.createElement('button')
    install.disabled = disabled
    const onInstall = vi.fn()
    install.addEventListener('click', onInstall)
    entry.appendChild(install)
    const content = document.createElement('div')
    content.dataset.tour = 'settings-mcp'
    content.style.overflowY = 'auto'
    content.scrollTop = 180
    content.appendChild(entry)
    panel.appendChild(content)
    const tab = document.createElement('button')
    tab.dataset.tour = 'settings-mcp-tab'
    const onSelect = vi.fn(() => panel.setAttribute('aria-hidden', 'false'))
    tab.addEventListener('click', onSelect)
    document.body.append(tab, panel)
    const step = steps.find((item) => item.id === 'settingsSkills')!

    await prepareProductTourDom(step, new AbortController().signal)
    await prepareProductTourDom(step, new AbortController().signal)

    expect(onSelect).toHaveBeenCalledOnce()
    expect(document.querySelector(step.element!)).toBe(entry)
    expect(entry.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    expect(onInstall).not.toHaveBeenCalled()
  })

  it('已取消的 Skills 步骤不滚动已存在的入口', async () => {
    const panel = document.createElement('div')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-hidden', 'false')
    const entry = document.createElement('span')
    entry.dataset.tour = 'settings-skills-install'
    entry.scrollIntoView = vi.fn()
    panel.appendChild(entry)
    document.body.appendChild(panel)
    const controller = new AbortController()
    controller.abort()

    await prepareProductTourDom(steps.find((item) => item.id === 'settingsSkills')!, controller.signal)

    expect(entry.scrollIntoView).not.toHaveBeenCalled()
  })

  it('取消设置页准备后，不切换迟到的页签', async () => {
    const controller = new AbortController()
    const preparation = prepareProductTourDom(
      steps.find((step) => step.id === 'settingsAgent')!, controller.signal,
    )
    controller.abort()
    const tab = document.createElement('button')
    tab.dataset.tour = 'settings-agent-tab'
    const onSelect = vi.fn()
    tab.addEventListener('click', onSelect)
    document.body.appendChild(tab)

    await preparation

    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each([
    ['extensionsMcp', 'mcp'], ['extensionsInstallation', 'mcp'], ['extensionsSkills', 'skill'], ['extensionsSearch', 'search'],
  ] as const)('%s 先激活外层设置再切换内层页签，不触发导入、测试或安装', async (id, kind) => {
    const panel = document.createElement('section')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-hidden', 'true')
    panel.innerHTML = '<div data-tour="settings-extensions"><div role="tabpanel" aria-hidden="true"><div data-tour="extensions-mcp"></div></div></div>'
    const outer = panel.firstElementChild!
    const old = outer.firstElementChild!
    const inner = document.createElement('div')
    inner.setAttribute('role', 'tabpanel')
    inner.setAttribute('aria-hidden', 'true')
    inner.innerHTML = `<div data-tour="extensions-${kind}"><button data-tour="extensions-installation"></button><button>业务操作</button></div>`
    const operation = vi.fn()
    inner.querySelector('button:last-child')!.addEventListener('click', operation)
    const innerTab = document.createElement('button')
    innerTab.dataset.tour = `extensions-${kind}-tab`
    const selectInner = vi.fn(() => { old.setAttribute('aria-hidden', 'true'); inner.setAttribute('aria-hidden', 'false') })
    innerTab.addEventListener('click', selectInner)
    outer.append(innerTab, inner)
    const outerTab = document.createElement('button')
    outerTab.dataset.tour = 'settings-extensions-tab'
    const selectOuter = vi.fn(() => panel.setAttribute('aria-hidden', 'false'))
    outerTab.addEventListener('click', selectOuter)
    document.body.append(outerTab, panel)
    await prepareProductTourDom(steps.find(step => step.id === id)!, new AbortController().signal)
    expect(selectOuter).toHaveBeenCalledOnce()
    expect(selectInner).toHaveBeenCalledOnce()
    expect(inner).toHaveAttribute('aria-hidden', 'false')
    expect(old).toHaveAttribute('aria-hidden', 'true')
    expect(operation).not.toHaveBeenCalled()
  })

  it('工作台视图准备等待有限时间，不替用户打开流程或修改目标', async () => {
    vi.useFakeTimers()
    const action = document.createElement('button')
    const operation = vi.fn()
    action.addEventListener('click', operation)
    document.body.append(action)
    try {
      const preparation = prepareProductTourDom(steps.find(step => step.id === 'automationEditor')!, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(1200)
      await expect(preparation).resolves.toBeUndefined()
      expect(operation).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})
