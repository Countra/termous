import ReactDOM from 'react-dom/client'
import '#shared/styles'
import '#shared/i18n'
import { WorkflowWindowPreview } from './workflow-window-preview-app'

ReactDOM.createRoot(document.getElementById('root')!).render(<WorkflowWindowPreview />)
