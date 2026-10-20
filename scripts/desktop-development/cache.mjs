import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function assertShellStopped(directory, probe = pid => process.kill(pid, 0)) {
  let record
  try { record = JSON.parse(await readFile(path.join(directory, 'active.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) throw new Error('开发壳占用记录无效，请检查 TEMP/desktop-development')
  try { probe(record.pid) } catch (error) { if (error.code === 'ESRCH') return; throw error }
  throw new Error('Termous Dev 正在运行，请关闭开发版后重试')
}

export async function withShellPreparation(directory, action) {
  const lock = path.join(directory, 'preparing')
  try { await mkdir(lock) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('开发壳正在准备；若上次准备被中断，请先运行 pnpm dev:clean', { cause: error })
    throw error
  }
  try {
    await writeFile(path.join(lock, 'active.json'), JSON.stringify({ pid: process.pid }))
    return await action()
  }
  finally { await rm(lock, { recursive: true, force: true }) }
}
