interface Receipt {
  id: string
  send: (id: string) => Promise<unknown>
  pending?: Promise<unknown>
}

// 只保留尚未收到确认的输入和文件；显式重试沿用请求 ID，避免已接收的附件重复上传。
export class DetachedPendingReceipts {
  private readonly entries = new Map<string, Receipt>()

  start(key: string, send: Receipt['send']) {
    const receipt: Receipt = { id: crypto.randomUUID(), send }
    this.entries.set(key, receipt)
    return this.dispatch(key, receipt)
  }

  private dispatch(key: string, receipt: Receipt) {
    const pending = Promise.resolve().then(() => receipt.send(receipt.id))
    receipt.pending = pending
    void pending.then(() => {
      if (this.entries.get(key) === receipt) this.entries.delete(key)
    }, () => { receipt.pending = undefined })
    return pending
  }

  async flush(retry = true) {
    await Promise.all([...this.entries].map(([key, receipt]) => {
      if (receipt.pending) return receipt.pending
      if (retry) return this.dispatch(key, receipt)
      throw new Error('detached_receipt_unconfirmed')
    }))
  }
}
