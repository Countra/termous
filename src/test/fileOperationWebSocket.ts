// 文件任务 UI 测试显式驱动事件，避免真实网络回调与虚拟时钟交错。
export class FileOperationWebSocket {
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FileOperationWebSocket[] = []

  readyState = 1
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(readonly url: string) {
    FileOperationWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    this.readyState = FileOperationWebSocket.CLOSED
  }

  emit(type: string, event: unknown = {}) {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}
