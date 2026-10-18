import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// 独立 Vite 入口不启动 Electron 主程序，避免接触开发账号的数据目录。
const root = fileURLToPath(new URL('../../', import.meta.url))
const server = await createServer({ configFile: false, root, cacheDir: fileURLToPath(new URL('../../../TEMP/vite', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 5183, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } } })
await server.listen()
console.log('http://127.0.0.1:5183/scripts/remote/preview.html')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void server.close().then(() => process.exit(0)) })
