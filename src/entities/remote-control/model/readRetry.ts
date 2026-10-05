const transientCodes = new Set([
  'remote_recovering', 'remote_request_timeout', 'remote_capacity_exceeded',
  'remote_signaling_unavailable', 'remote_request_failed',
])

export function isTransientRemoteReadError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && transientCodes.has(code.toLowerCase())
}

// 仅用于只读查询；短暂抖动先补读，确定性拒绝和写操作不能借此自动重放。
export async function retryRemoteRead<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const deadline = Date.now() + 5000
  const delays = [400, 1200]
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { const value = await read(); signal?.throwIfAborted(); return value } catch (error) {
      signal?.throwIfAborted()
      const delay = delays[attempt]
      if (delay === undefined || !isTransientRemoteReadError(error) || Date.now() + delay >= deadline) throw error
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, delay)
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
  }
}
