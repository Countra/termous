import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import './index.css'
import { loadRendererSurface } from './app/rendererSurface'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('缺少 Renderer 根节点')
}

const root = ReactDOM.createRoot(rootElement)

void loadRendererSurface(window.location.search, {
  main: () => import('./App.tsx'),
  update: () => import('./features/update/UpdateWindowRoot.tsx'),
}).then(({ default: SurfaceRoot }) => {
  root.render(
    <React.StrictMode>
      <SurfaceRoot />
    </React.StrictMode>,
  )
}).catch(() => {
  throw new Error('Renderer 界面加载失败')
})
