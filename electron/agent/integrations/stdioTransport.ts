import { StdioTransport, type StdioTransportOptions } from '@earendil-works/pi-mcp'

type SuperviseGroup = (pid: number, release: boolean) => Promise<void>

// Windows 使用宿主 Job；POSIX 将 pi-mcp 独立进程组交给 Core，避免宿主崩溃后遗留服务。
export class SupervisedStdioTransport extends StdioTransport {
  private readonly supervise?: SuperviseGroup
  private ownedPID?: number
  private closing?: Promise<void>

  constructor(options: StdioTransportOptions, supervise?: SuperviseGroup) {
    super(options)
    this.supervise = supervise
  }

  override async start() {
    if (process.platform !== 'win32' && !this.supervise) throw new Error('INTEGRATION_PROCESS_SUPERVISION_REQUIRED')
    await super.start()
    if (process.platform === 'win32') return
    const pid = this.pid
    if (!pid) { await super.close(); throw new Error('INTEGRATION_PROCESS_UNAVAILABLE') }
    try {
      await this.supervise!(pid, false)
      if (this.closing) {
        await this.supervise!(pid, true)
        throw new Error('INTEGRATION_PROCESS_CLOSED')
      }
      this.ownedPID = pid
    } catch (error) { await super.close(); throw error }
  }

  override close() {
    this.closing ??= this.closeOwned()
    return this.closing
  }

  private async closeOwned() {
    try { await super.close() }
    finally {
      if (this.ownedPID) {
        const pid = this.ownedPID
        this.ownedPID = undefined
        await this.supervise!(pid, true)
      }
    }
  }
}
