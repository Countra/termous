import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm, stat } from 'node:fs/promises'
import { assertShellStopped } from './cache.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../TEMP/desktop-development')
const target = path.join(root, `${process.platform}-${process.arch}`)
if (path.dirname(target) !== root) throw new Error('开发壳清理目录无效')
await assertShellStopped(target)
let preparing = false
try { await stat(path.join(target, 'preparing')); preparing = true }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (preparing) {
  try { await stat(path.join(target, 'preparing/active.json')) }
  catch (error) { throw new Error('开发壳准备锁尚未写入完成，请等待准备结束后重试', { cause: error }) }
  await assertShellStopped(path.join(target, 'preparing'))
}
// 仅清理当前平台的生成产物；用户偏好、外部 Core 和正式安装不在此目录。
await rm(target, { recursive: true, force: true })
console.log('Termous Dev 开发壳缓存已清理')
