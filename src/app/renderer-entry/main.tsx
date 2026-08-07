import React from 'react'
import ReactDOM from 'react-dom/client'
import '#shared/i18n'
import '#shared/styles'
import { loadRendererSurface } from './rendererSurface.ts'
import { installDevelopmentUpdateSimulation } from '#app/update-simulation-slot'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('缺少 Renderer 根节点')
}

const root = ReactDOM.createRoot(rootElement)

const prepareDevelopmentUpdateSimulation = import.meta.env.DEV
  ? import('#app/update-simulation')
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
  main: () => import('#app/main'),
  update: () => import('#app/update-surface'),
})).then(({ default: SurfaceRoot }) => {
  root.render(
    <React.StrictMode>
      <SurfaceRoot />
    </React.StrictMode>,
  )
}).catch(() => {
  throw new Error('Renderer 界面加载失败')
})
