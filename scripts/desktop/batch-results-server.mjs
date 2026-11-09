import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const evidence = path.resolve(root, '../TEMP/desktop-batch-live')
const server = await createServer({ configFile: false, root, cacheDir: '../TEMP/vite', plugins: [react(), {
  name: 'desktop-batch-live-evidence',
  configureServer(vite) {
    // 仅暴露本次验收报告和按唯一命令标识保存的 PNG，不开放任意文件或目录浏览。
    vite.middlewares.use('/batch-evidence', (request, response) => {
      const name = (request.url ?? '').slice(1)
      if (request.method !== 'GET' || !/^(rdp-result\.json|check-\d+-\d+-\d+\.png)$/u.test(name)) { response.statusCode = 404; response.end(); return }
      void readFile(path.join(evidence, name)).then(data => {
        response.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(data)
      }).catch(error => { response.statusCode = error.code === 'ENOENT' ? 404 : 500; response.end('验收产物不可读') })
    })
  },
}], server: { host: '127.0.0.1', port: 5196, strictPort: true } })
await server.listen()
