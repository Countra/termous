import ReactDOM from 'react-dom/client'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import { RemoteWorkbench } from '#widgets/remote-workbench'
import { createPreview } from './previewBridge'
import { RemoteAgentSurface } from '../../src/app/remote-surface/ui/RemoteAgentSurface'

// 独立测试入口只使用合成数据，不装配主工作台、账号或本机文件能力。
const { bridge, bootstrap } = createPreview(new URLSearchParams(location.search))
ReactDOM.createRoot(document.getElementById('root')!).render(<TermousUiProvider language={bootstrap.language} theme={bootstrap.theme}><RemoteWorkbench bridge={bridge} bootstrap={bootstrap} renderAgent={(client, active, quote) => <RemoteAgentSurface client={client} active={active} quote={quote} />} /></TermousUiProvider>)
