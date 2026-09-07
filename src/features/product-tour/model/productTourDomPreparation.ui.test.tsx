import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareProductTourDom } from './productTourDomPreparation.ts'
import { buildProductTourSteps } from './productTourSteps.ts'

const steps = buildProductTourSteps((key) => key)

describe('使用向导页面准备', () => {
  beforeEach(() => {
    document.body.replaceChildren()
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
})
