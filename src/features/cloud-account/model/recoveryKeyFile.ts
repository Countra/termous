import { CLOUD_PERSONAL_KEY_FILE_EXTENSION, CLOUD_PERSONAL_KEY_FILE_MAX_BYTES } from '#common/contracts'

// 只读取用户选中的小文件，不根据文件内容访问路径或远端服务。
export function readRecoveryKeyFile(file: File, signal: AbortSignal): Promise<string> {
  if (!file.name.toLowerCase().endsWith(CLOUD_PERSONAL_KEY_FILE_EXTENSION) || file.size === 0 || file.size > CLOUD_PERSONAL_KEY_FILE_MAX_BYTES) return Promise.reject(new Error('CLOUD_PERSONAL_FILE_INVALID'))
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('CLOUD_STALE')); return }
    const reader = new FileReader()
    const abort = () => reader.abort()
    const cleanup = () => signal.removeEventListener('abort', abort)
    reader.onload = () => {
      cleanup()
      try {
        if (!(reader.result instanceof ArrayBuffer)) throw new Error('CLOUD_PERSONAL_FILE_INVALID')
        const bytes = new Uint8Array(reader.result)
        try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
        finally { bytes.fill(0) }
      } catch { reject(new Error('CLOUD_PERSONAL_FILE_INVALID')) }
    }
    reader.onerror = () => { cleanup(); reject(new Error('CLOUD_PERSONAL_FILE_READ_FAILED')) }
    reader.onabort = () => { cleanup(); reject(new Error('CLOUD_STALE')) }
    signal.addEventListener('abort', abort, { once: true })
    try { reader.readAsArrayBuffer(file) }
    catch { cleanup(); reject(new Error('CLOUD_PERSONAL_FILE_READ_FAILED')) }
  })
}
