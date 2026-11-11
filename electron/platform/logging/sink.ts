import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { write } from 'node:fs'
import path from 'node:path'

export interface ProcessLogSink { name: 'file' | 'stderr'; write(batch: string): Promise<void> }
const maxFileBytes = 512 * 1024

export function fileLogSink(directory: () => string): ProcessLogSink {
  let initialized = false, size = 0
  return { name: 'file', async write(batch) {
    try {
      const folder = directory(), target = path.join(folder, 'electron-process.log')
      if (!initialized) {
        await mkdir(folder, { recursive: true })
        try { size = (await stat(target)).size } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          size = 0
        }
        initialized = true
      }
      const bytes = Buffer.byteLength(batch)
      if (size > 0 && size + bytes > maxFileBytes) {
        await rm(`${target}.1`, { force: true })
        await rename(target, `${target}.1`)
        size = 0
      }
      await appendFile(target, batch, 'utf8')
      size += bytes
    } catch (error) { initialized = false; throw error }
  } }
}

// fs.write 的回调接口避免部分平台的 console/stderr 同步写入阻塞主线程。
export function stderrLogSink(): ProcessLogSink {
  return { name: 'stderr', async write(batch) {
    const buffer = Buffer.from(batch)
    let offset = 0
    while (offset < buffer.length) {
      const written = await new Promise<number>((resolve, reject) => {
        write(2, buffer, offset, buffer.length - offset, null, (error, bytes) => {
          if (error) reject(error)
          else if (!bytes) reject(new Error('stderr_write_empty'))
          else resolve(bytes)
        })
      })
      offset += written
    }
  } }
}
