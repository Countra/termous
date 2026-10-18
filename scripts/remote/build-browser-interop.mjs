import { build } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.argv[2]
if (!output || !path.isAbsolute(output)) throw new Error('必须提供互通夹具的绝对输出目录')
// 复用工作区已安装的 Vite，仅编译合成测试页，不启动 Electron 或产品服务。
await build({ configFile: false, root: path.join(root, '../termous-remote'), build: { outDir: output, emptyOutDir: false, lib: { entry: path.join(root, '../termous-remote/tests/browser/main.ts'), formats: ['es'], fileName: () => 'browser.js' }, minify: false } })
