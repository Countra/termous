import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const server = await createServer({ root, configFile: false, cacheDir: fileURLToPath(new URL('../../../TEMP/vite', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 4176, strictPort: true } })
await server.listen()
console.log('http://127.0.0.1:4176/tests/desktop-presentation/')
