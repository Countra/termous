import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { ExchangeFailure } from './files.ts'

// 路径只保留在主进程；渲染层只能打开已成功导出且属于当前发送方的位置。
export class ExportLocations {
  private entries = new Map<string, { sender: number; directory: string }>()
  private openPath: (directory: string) => Promise<string>
  constructor(openPath: (directory: string) => Promise<string>) { this.openPath = openPath }
  remember(sender: number, directory: string): string {
    const id = randomUUID()
    this.entries.set(id, { sender, directory })
    if (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!)
    return id
  }
  async open(sender: number, id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || entry.sender !== sender) throw new ExchangeFailure('workflow_exchange_location_unavailable')
    try {
      if (!(await stat(entry.directory)).isDirectory()) throw new ExchangeFailure('workflow_exchange_directory_missing')
      if (await this.openPath(entry.directory)) throw new ExchangeFailure('workflow_exchange_directory_open_failed')
    } catch (error) {
      if (error instanceof ExchangeFailure) throw error
      const code = (error as NodeJS.ErrnoException)?.code
      throw new ExchangeFailure(code === 'ENOENT' || code === 'ENOTDIR' ? 'workflow_exchange_directory_missing' : 'workflow_exchange_directory_open_failed')
    }
  }
  clear() { this.entries.clear() }
}
