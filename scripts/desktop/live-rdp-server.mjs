import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// 真实联调只提供本机页面及受限测试入口代理，不启动合成桌面服务。
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)), cacheDir: fileURLToPath(new URL('../../../TEMP/vite', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 5191, strictPort: true, hmr: false, proxy: { '/fixture': { target: 'http://127.0.0.1:5195', ws: true } } } })
await server.listen()
console.log('Live RDP: http://127.0.0.1:5191/scripts/desktop/live-rdp.html')
console.log('Live VNC: http://127.0.0.1:5191/scripts/desktop/live-vnc.html')
const close = async () => { await server.close(); process.exit(0) }
process.on('SIGINT', close)
process.on('SIGTERM', close)
