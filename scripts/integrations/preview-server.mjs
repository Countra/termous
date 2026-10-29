import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root=fileURLToPath(new URL('../../',import.meta.url))
const server=await createServer({configFile:false,root,cacheDir:fileURLToPath(new URL('../../../TEMP/vite-integrations',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false}})
await server.listen()
server.printUrls()
process.on('SIGINT',()=>{void server.close().then(()=>process.exit(0))})
process.on('SIGTERM',()=>{void server.close().then(()=>process.exit(0))})
