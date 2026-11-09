import { DesktopResizeUnconfirmedError, type DesktopSize } from '../../core/desktopResolution.ts'

interface Receipt { sequence: bigint; controlGeneration: bigint }

export function createRdpResizeRequest(send: (size: DesktopSize) => Receipt | undefined) {
  let pending: { receipt: Receipt; resolve(): void; reject(error: Error): void } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const matches = (receipt?: Receipt) => !!pending && !!receipt
    && pending.receipt.sequence === receipt.sequence && pending.receipt.controlGeneration === receipt.controlGeneration
  function reset(unconfirmed = true) {
    clearTimeout(timer)
    const previous = pending
    pending = undefined
    previous?.reject(unconfirmed ? new DesktopResizeUnconfirmedError() : new Error('rdp_resize_rejected'))
  }
  return {
    send(size: DesktopSize) {
      if (pending) return Promise.reject(new Error('rdp_resize_pending'))
      return new Promise<void>((resolve, reject) => {
        const receipt = send(size)
        if (!receipt) { reject(new Error('rdp_resize_unavailable')); return }
        pending = { receipt, resolve, reject }
        timer = setTimeout(() => reset(), 10_000)
      })
    },
    acknowledge(receipt: Receipt) {
      if (!matches(receipt)) return
      clearTimeout(timer)
      const previous = pending
      pending = undefined
      previous?.resolve()
    },
    fail(receipt?: Receipt) {
      if (!matches(receipt)) return false
      reset(false)
      return true
    },
    reset,
  }
}
