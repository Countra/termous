import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import identities from '../../common/desktop-identity/identities.json' with { type: 'json' }

export function developmentBranding() {
  const directory = new URL(`../../${identities.development.iconDirectory}/`, import.meta.url)
  const assets = new Map([
    ['/termous-icon.png', ['icon.png', 'image/png']],
    ['/favicon.png', ['icon.png', 'image/png']],
    ['/favicon.ico', ['icon.ico', 'image/x-icon']],
  ])
  return {
    name: 'termous-development-branding',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = assets.get(request.url?.split('?')[0])
        if (!asset || !['GET', 'HEAD'].includes(request.method)) return next()
        // 仅替换开发服务的固定品牌资源，正式构建及页面业务逻辑沿用原实现。
        void readFile(fileURLToPath(new URL(asset[0], directory))).then(content => {
          if (response.destroyed) return
          response.setHeader('Content-Type', asset[1])
          response.setHeader('Content-Length', content.length)
          response.setHeader('Cache-Control', 'no-store')
          response.end(request.method === 'HEAD' ? undefined : content)
        }).catch(next)
      })
    },
  }
}
