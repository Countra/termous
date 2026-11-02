import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TermousUiProvider } from '#app/ui-runtime'
import DetachedSurfaceRoot from '#app/detached-surface'
import { WorkflowClient, WorkflowExchangeClient, WorkflowWorkspace } from '#features/desktop-workflows'
import '#shared/i18n'
import '#shared/styles'

// 只连接验收 runner 启动的隔离 Core；不读取应用配置或真实桌面会话。
const config = { apiBaseUrl: location.origin, apiToken: 'workflow-exchange-acceptance' }
const gateway = new WorkflowClient(config)
gateway.hostSources = async () => []
const exchange = new WorkflowExchangeClient(config)
const detached = new URLSearchParams(location.search).get('surface') === 'detached'
createRoot(document.getElementById('root')!).render(<StrictMode>{detached ? <DetachedSurfaceRoot /> :
  <TermousUiProvider theme="dark" language="zh-CN">
    <div style={{ height: '100dvh' }}><WorkflowWorkspace gateway={gateway} exchangeGateway={exchange} sessions={[]} profiles={[]}
      onDirtyChange={() => {}} onViewDesktop={() => {}} appearance={{ theme: 'dark', language: 'zh-CN' }} /></div>
  </TermousUiProvider>}
</StrictMode>)
