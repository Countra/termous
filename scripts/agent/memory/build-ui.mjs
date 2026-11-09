import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, loadConfigFromFile } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const output = path.resolve(root, '../TEMP/agent-memory-research/build/renderer')
// 仅构建连接隔离测试 Core 的页面，不覆盖开发产物或读取真实 Agent 配置。
process.env.VITE_TERMOUS_API_BASE_URL = 'http://127.0.0.1:18122'
process.env.VITE_TERMOUS_API_TOKEN = 'memory-acceptance-local'
const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.config.ts'), root)
if (!loaded) throw new Error('未读取到项目构建配置')
const plugins = loaded.config.plugins.flat(Infinity).filter(plugin => !plugin?.name?.startsWith('vite-plugin-electron:'))
await build({ ...loaded.config, configFile: false, root, plugins,
  build: { ...loaded.config.build, outDir: output } })
