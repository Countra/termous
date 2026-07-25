export class AsyncSingleflight<TResult> {
  private pending: Promise<TResult> | null = null

  run(operation: () => Promise<TResult>): Promise<TResult> {
    if (this.pending) {
      return this.pending
    }
    let result: Promise<TResult>
    try {
      result = operation()
    } catch (error) {
      result = Promise.reject(error)
    }
    const pending = Promise.resolve(result)
      .finally(() => {
        if (this.pending === pending) {
          this.pending = null
        }
      })
    this.pending = pending
    return pending
  }

  isRunning() {
    return this.pending !== null
  }
}
