import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// 显式关闭主项目配置，防止界面夹具启动正式 Electron 或 Core。
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)), cacheDir: '../TEMP/vite-workflow-fixture', plugins: [react()], server: { host: '127.0.0.1', port: 5196, strictPort: true } })
await server.listen()
