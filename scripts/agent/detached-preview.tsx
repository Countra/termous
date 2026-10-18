import ReactDOM from 'react-dom/client'
import '#shared/styles'
import '#shared/i18n'
import { DetachedPreview } from './detached-preview-app.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(<DetachedPreview />)
