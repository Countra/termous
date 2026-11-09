import { createRoot } from 'react-dom/client'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import { AssistantExtensions } from '#features/agent-integrations'
import { createIntegrationFixture, installIntegrationConnectionFixture } from './fixture'
import { MCPProvisionPreview } from './MCPProvisionPreview'

const params=new URLSearchParams(location.search)
const disposeConnection = params.has('connection-test') ? installIntegrationConnectionFixture() : () => {}
const gateway = createIntegrationFixture({ toggleDelayMs: params.has('toggle-delay') ? 5000 : 0 })
const root=createRoot(document.getElementById('root')!)
root.render(<TermousUiProvider language={params.has('en')?'en-US':'zh-CN'} theme={params.has('light')?'light':'dark'}>{params.has('provision') ? <MCPProvisionPreview /> : <AssistantExtensions gateway={gateway}/>}</TermousUiProvider>)
import.meta.hot?.dispose(()=>{root.unmount();disposeConnection()})
