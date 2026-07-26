import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import './index.css'
import { loadRendererSurface } from './app/rendererSurface'
import { installDevelopmentUpdateSimulation } from './features/update/developmentUpdateSimulationSlot'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('缺少 Renderer 根节点')
}

const root = ReactDOM.createRoot(rootElement)

const prepareDevelopmentUpdateSimulation = import.meta.env.DEV
  ? import('./features/update/developmentUpdateSimulation')
      .then(({ createDevelopmentUpdateSimulation }) => {
        const simulation = createDevelopmentUpdateSimulation(
          true,
          window.location.search,
        )
        if (simulation) {
          installDevelopmentUpdateSimulation(simulation)
        }
      })
  : Promise.resolve()

void prepareDevelopmentUpdateSimulation.then(() => loadRendererSurface(window.location.search, {
  main: () => import('./App.tsx'),
  update: () => import('./features/update/UpdateWindowRoot.tsx'),
})).then(({ default: SurfaceRoot }) => {
  root.render(
    <React.StrictMode>
      <SurfaceRoot />
    </React.StrictMode>,
  )
}).catch(() => {
  throw new Error('Renderer 界面加载失败')
})
