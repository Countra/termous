import type { WorkflowFileBridge, WorkflowFileProgress } from '#common/contracts'
import type { Script, WorkflowExchangeGateway, WorkflowImportReceipt, WorkflowImportView } from '#entities/desktop-workflow'

// 视觉验收只使用内存快照与合成图片，不读取磁盘文件、不连接桌面，也不派发输入。
export function workflowExchangeDesignFixture(script: Script) {
  const listeners = new Set<(progress: WorkflowFileProgress) => void>()
  const cancelled = new Set<string>()
  const preview: WorkflowImportView = {
    id: 'design-import', state: 'ready', assets: [
      { path: 'assets/login-button.png', sha256: 'login', size: 2300, width: 180, height: 52 },
      { path: 'assets/home-header.png', sha256: 'home', size: 4200, width: 280, height: 80 },
    ], manifest: {
      format: 'termous.desktop-workflow', format_version: 1, name: '登录界面回归',
      description: '等待登录入口，填写账号后检查主界面。适用于远程工作站的登录回归与日常巡检。',
      tags: ['回归测试', '登录流程'], assets: [{ path: 'assets/login-button.png' }, { path: 'assets/home-header.png' }],
      definition: { schema_version: 2, parameters: [{ id: 'account', name: '登录账号', type: 'string' }], steps: [
        { id: 'wait', kind: 'image.wait', name: '等待登录入口', action: {}, image: { path: 'assets/login-button.png', offset: { x: 0, y: 0 } } },
        { id: 'text', kind: 'keyboard.text', name: '输入账号', action: {}, bindings: { text: 'account' } },
        { id: 'submit', kind: 'keyboard.key', name: '确认登录', action: { code: 'Enter' } },
        { id: 'home', kind: 'image.assert', name: '确认主界面', action: {}, image: { path: 'assets/home-header.png', offset: { x: 0, y: 0 } } },
      ] },
    },
  }
  let receipt: WorkflowImportReceipt | undefined
  const exchange: WorkflowExchangeGateway = {
    inspect: async () => receipt ? { ...preview, state: 'committed', receipt } : preview,
    release: async () => undefined,
    commit: async (_id, input) => {
      receipt = { import_id: preview.id, script: { ...script, name: input.name ?? preview.manifest!.name, revision: input.mode === 'update' ? script.revision + 1 : 1 }, created_at: new Date().toISOString() }
      return receipt
    },
    asset: async (_id, hash) => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80" viewBox="0 0 280 80"><rect width="280" height="80" rx="8" fill="#171e2b"/><rect x="20" y="20" width="${hash === 'login' ? '240' : '40'}" height="40" rx="6" fill="#357cd2"/><text x="${hash === 'login' ? '140' : '80'}" y="46" fill="white" font-family="sans-serif" text-anchor="${hash === 'login' ? 'middle' : 'start'}" font-size="14">${hash === 'login' ? 'Sign in' : 'Workspace'}</text></svg>`], { type: 'image/svg+xml' }),
  }
  const files: WorkflowFileBridge = {
    onProgress: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    cancel: async id => { cancelled.add(id) },
    openDirectory: async () => ({}),
    run: async request => {
      for (const phase of ['selecting', 'validating'] as const) {
        listeners.forEach(listener => listener({ operation_id: request.operation_id, phase }))
        await new Promise(resolve => setTimeout(resolve, 350))
        if (cancelled.delete(request.operation_id)) return { canceled: true }
      }
      return request.kind === 'import' ? { import_id: preview.id } : { location_id: 'design-export-location', file_name: request.layout === 'zip' ? 'workflow.termous-workflow.zip' : request.layout === 'directory' ? 'workflow.termous-workflow' : 'workflow.json' }
    },
  }
  return { files, exchange }
}
