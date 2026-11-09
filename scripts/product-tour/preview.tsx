import { createRoot } from 'react-dom/client'
import '#shared/styles'
import '#shared/i18n'
import { ProductTourPreview } from './ProductTourPreview'

const root = createRoot(document.getElementById('root')!)
root.render(<ProductTourPreview />)
import.meta.hot?.dispose(() => root.unmount())
